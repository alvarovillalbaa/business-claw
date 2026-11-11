#!/usr/bin/env python3
"""One owned public-CI hosted-preview check. No app install/server/account/API write."""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

BASE = "ec2521fe30249fc8d950544cf57532e74749e126"
REPOSITORY = "alvarovillalbaa/business-claw"
BRANCH = "refs/heads/qa/business-claw-preview-browser-20261111-1"
ADDED = {"tests/e2e/preview-browser.mjs", "tests/support/run-preview-browser.py", "tests/README.md",
         "tests/fixtures/browser-tool-package.json", "tests/fixtures/browser-tool-package-lock.json",
         "docs/proposals/preview-browser-ci.md", "docs/proposals/preview-browser-ci.workflow.yml.example"}
WEB = ["web/" + name for name in ("index.html", "app.mjs", "domain.mjs", "server-client.mjs", "styles.css", "favicon.svg")]
EXPORT = WEB + ["docs/fixtures/workspace.json", "docs/fixtures/invalid-workspace.json", "tests/e2e/preview-browser.mjs"]
SOURCE = sys.argv[2] if len(sys.argv) == 3 and sys.argv[1] == "--source-commit" else None
REPO = Path.cwd().resolve()
LIMIT, STREAM_LIMIT = 2 * 1024**3, 1024**2
root = proof = nonce = None
root_id = proof_id = None
env = {}
work_end = cleanup_end = job_end = None
stopped = False
children, attributed, prior = [], {}, {}
source_vector = runtime_vector = export_vector = None
browser_binaries = {}
report = {"schemaVersion": "business-claw.preview-browser-controller.v1", "sourceCommit": SOURCE,
          "baseCommit": BASE, "passed": False, "productAccepted": False, "commands": [], "guards": [],
          "errors": [], "cleanup": {}, "proofDisposition": "pending_upload_and_retirement",
          "scope": {"caseIDs": ["B01", "B02", "B03", "B04"], "hostedLocalPreview": True,
                    "account": False, "serverAPIWrites": False, "privateData": False, "modelProvider": False,
                    "appDependencyInstall": False, "oldDomainBackendCasesRepeated": False},
          "proofLimits": ["Separate headless CI Chromium profile; no manual-Chrome completion is inferred.",
            "Fresh authored browser contexts; no Auth/database/compute/Gateway/tenant-isolation qualification.",
            "Source/file/process observations are boundary checks, not host-wide continuous or runner-disposal attestation.",
            "Controller root cleanup precedes artifact upload. Proof retirement is separately required after successful upload."]}


def need(value, message):
    if not value:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def budget():
    deadline = cleanup_end if cleanup_end is not None else work_end
    need(not stopped or cleanup_end is not None, "controller_interrupted")
    need(deadline is None or time.monotonic() < deadline - 2, "controller_deadline")


def identity(p):
    s = p.lstat()
    return {"device": s.st_dev, "inode": s.st_ino, "uid": s.st_uid,
            "mode": stat.S_IMODE(s.st_mode), "bytes": s.st_size, "mtimeNs": s.st_mtime_ns, "ctimeNs": s.st_ctime_ns}


def read(p, maximum=16*1024**2):
    p = Path(p); before = identity(p)
    need(stat.S_ISREG(p.lstat().st_mode) and 0 <= before["bytes"] <= maximum, "regular_read_bound")
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        with os.fdopen(fd, "rb", closefd=False) as stream:
            body = stream.read(maximum+1)
        need(len(body) == before["bytes"] and identity(p) == before, "read_identity_changed")
        return body
    finally:
        os.close(fd)


def fingerprint(p):
    p=Path(p); before=identity(p)
    need(stat.S_ISREG(p.lstat().st_mode) and before["uid"] == os.getuid(), "owned_regular_required")
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW); digest=hashlib.sha256()
    try:
        while True:
            budget(); block=os.read(fd,1024**2)
            if not block: break
            digest.update(block)
        need(identity(p)==before,"fingerprint_changed")
    finally:
        os.close(fd)
    return {**before,"sha256":digest.hexdigest()}


def owner(include_root=True):
    for p,expected in ([(root,root_id),(proof,proof_id)] if include_root else [(proof,proof_id)]):
        need(p is not None and p.resolve(strict=True)==p,"owner_path_changed")
        s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==os.getuid() and stat.S_IMODE(s.st_mode)==0o700
                           and (s.st_dev,s.st_ino)==expected,"owner_identity_changed")
        marker=p/".owner";m=marker.lstat()
        need(stat.S_ISREG(m.st_mode) and m.st_uid==os.getuid() and stat.S_IMODE(m.st_mode)==0o600
             and read(marker,32)==nonce.encode(),"owner_marker_changed")


def write(p,body,maximum=2*1024**2):
    need(len(body)<=maximum and not os.path.lexists(p),"exclusive_write_bound")
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"wb") as stream:
        stream.write(body);stream.flush();os.fsync(stream.fileno())


def processes():
    rows={}
    for p in Path('/proc').iterdir():
        if not p.name.isdigit():continue
        try:
            text=(p/'stat').read_text();parts=text[text.rfind(')')+2:].split()
            rows[int(p.name)]={"pid":int(p.name),"ppid":int(parts[1]),"pgid":int(parts[2]),"start":parts[19],"uid":p.stat().st_uid}
        except (FileNotFoundError,ProcessLookupError,PermissionError,IndexError):continue
    return rows


def observe():
    rows=processes();changed=True
    while changed:
        changed=False
        for pid,row in rows.items():
            parent=attributed.get(row['ppid'])
            if pid not in attributed and row['uid']==os.getuid() and prior.get(pid)!=row['start'] and parent and rows.get(row['ppid'],{}).get('start')==parent['start']:
                attributed[pid]=row.copy();changed=True
    live=[r for p,r in rows.items() if p in attributed and attributed[p]['start']==r['start']]
    unknown=[]
    for pid,row in rows.items():
        if row['uid']!=os.getuid() or pid==os.getpid() or pid in attributed or prior.get(pid)==row['start']:continue
        try:
            args=(Path('/proc')/str(pid)/'cmdline').read_bytes()
            if root is not None and os.fsencode(root) in args:unknown.append(row)
        except (FileNotFoundError,ProcessLookupError,PermissionError):continue
    return rows,live,unknown


def group_absent(pid):
    try:os.killpg(pid,0);return False
    except ProcessLookupError:return True
    except PermissionError:return False


def terminate(child,force=False):
    rows,_,_=observe();members=[r for r in rows.values() if r['pgid']==child.pid]
    need(all(r['pid'] in attributed and r['uid']==os.getuid() and attributed[r['pid']]['start']==r['start'] for r in members),"process_signal_attribution_refused")
    if members:
        try:os.killpg(child.pid,signal.SIGKILL if force else signal.SIGTERM)
        except ProcessLookupError:pass


def storage():
    total=count=0
    for folder,dirs,files in os.walk(root,followlinks=False):
        for name in dirs+files:
            p=Path(folder)/name;s=p.lstat();count+=1
            if stat.S_ISREG(s.st_mode):total+=s.st_size
            need(count<=100000 and total<=LIMIT,"owned_storage_bound")
    need(shutil.disk_usage(root).free>=2*1024**3,"remote_disk_reserve_exhausted")
    return {"entries":count,"regularBytes":total}


def command(label,args,seconds=30,allowed=(0,),post_root=False):
    owner(not post_root);budget()
    if post_root:need(report['cleanup'].get('rootRemoved') and not os.path.lexists(root),'post_root_unverified')
    deadline=min(time.monotonic()+seconds,(cleanup_end if cleanup_end is not None else work_end)-8)
    need(time.monotonic()<deadline,'command_budget_exhausted')
    child=subprocess.Popen(args,cwd=REPO,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    children.append(child);row={"label":label,"pid":child.pid,"arguments":[str(x).replace(str(root),'[scratch]').replace(str(proof),'[proof]') for x in args]};report['commands'].append(row)
    states=[{"body":bytearray(),"digest":hashlib.sha256(),"bytes":0,"eof":False} for _ in range(2)]
    selector=selectors.DefaultSelector();stop_at=None
    try:
        rows=processes();need(child.pid in rows and rows[child.pid]['ppid']==os.getpid() and rows[child.pid]['pgid']==child.pid,'direct_child_identity_missing')
        attributed[child.pid]=rows[child.pid].copy()
        for i,pipe in enumerate((child.stdout,child.stderr)):
            os.set_blocking(pipe.fileno(),False);selector.register(pipe,selectors.EVENT_READ,i)
        sampled=time.monotonic()
        while True:
            now=time.monotonic();code=child.poll()
            if code is not None and all(s['eof'] for s in states) and group_absent(child.pid):break
            if now-sampled>=0.1:observe();sampled=now
            if (stopped and cleanup_end is None) or now>=deadline or any(s['bytes']>STREAM_LIMIT for s in states):
                if stop_at is None:stop_at=now
                terminate(child,now-stop_at>=3)
                if now-stop_at>8:break
            for key,_ in selector.select(0.025):
                block=os.read(key.fileobj.fileno(),65536);s=states[key.data]
                if not block:s['eof']=True;selector.unregister(key.fileobj);continue
                s['bytes']+=len(block);s['digest'].update(block);s['body'].extend(block[:max(0,STREAM_LIMIT-len(s['body']))])
    finally:
        selector.close()
        for pipe in (child.stdout,child.stderr):pipe.close()
        if child.poll() is None:
            terminate(child)
            try:child.wait(timeout=3)
            except subprocess.TimeoutExpired:terminate(child,True);child.wait(timeout=3)
        row.update({"exitCode":child.returncode,"reaped":child.returncode is not None,"groupAbsent":group_absent(child.pid),"stopped":stop_at is not None,"streams":[]})
        for name,s in zip(('stdout','stderr'),states):
            body=bytes(s['body']);filename=f"{len(report['commands']):03d}-{label}.{name}.log";write(proof/filename,body)
            row['streams'].append({"name":name,"file":filename,"bytes":len(body),"sha256":sha(body),"observedBytes":s['bytes'],"observedSha256":s['digest'].hexdigest(),"complete":s['eof'] and len(body)==s['bytes'],"gzipBase64":base64.b64encode(gzip.compress(body,mtime=0)).decode()})
    need(row['reaped'] and row['groupAbsent'] and not row['stopped'] and all(s['complete'] for s in row['streams']),'command_lifecycle_failed')
    need(row['exitCode'] in allowed,'command_exit_failed')
    if not post_root:report.setdefault('storageObservations',[]).append({"label":label,**storage()})
    return bytes(states[0]['body'])


def tree(data,index=False):
    out={}
    for row in data.split(b'\0'):
        if not row:continue
        header,name=row.split(b'\t',1);parts=header.decode().split();name=name.decode()
        need(not name.startswith('/') and all(p not in ('','..','.') for p in name.split('/')) and name not in out,'git_path_invalid')
        if index:mode,blob,stage=parts;need(stage=='0','unmerged_index')
        else:mode,kind,blob=parts;need(kind=='blob','nonblob_source')
        need(mode in ('100644','100755','120000') and re.fullmatch('[0-9a-f]{40}',blob),'git_entry_invalid');out[name]=(mode,blob)
    return out


def guard(label,post_root=False):
    global source_vector
    options={'post_root':post_root}
    need(command(label+'_head',['git','rev-parse','HEAD'],**options).decode().strip()==SOURCE,'source_head_changed')
    current=tree(command(label+'_tree',['git','ls-tree','-r','-z','HEAD'],**options));baseline=tree(command(label+'_base',['git','ls-tree','-r','-z',BASE],**options))
    need(tree(command(label+'_index',['git','ls-files','--stage','-z'],**options),True)==current,'source_index_changed')
    need(set(current)==set(baseline)|ADDED and not set(baseline)&ADDED,'source_scope_paths_changed')
    vector=[]
    for name,(mode,blob) in sorted(current.items()):
        p=REPO/name;s=p.lstat();body=os.fsencode(os.readlink(p)) if stat.S_ISLNK(s.st_mode) else read(p)
        actualmode='120000' if stat.S_ISLNK(s.st_mode) else '100755' if s.st_mode&0o111 else '100644'
        actual=hashlib.sha1(b'blob '+str(len(body)).encode()+b'\0'+body).hexdigest()
        need((actualmode,actual)==(mode,blob),'source_body_or_mode_changed')
        if name in baseline and name!='AGENTS.md':need((mode,blob)==baseline[name],'prior_input_changed')
        vector.append({'path':name,'mode':mode,'gitBlob':blob,'bytes':len(body),'sha256':sha(body)})
    prior_agents=command(label+'_prior_agents',['git','show',BASE+':AGENTS.md'],**options)
    need(read(REPO/'AGENTS.md').startswith(prior_agents),'prior_instructions_overwritten')
    for suffix,extra in [('status',[]),('ignored',['--ignored=matching'])]:
        need(command(label+'_'+suffix,['git','status','--porcelain=v1','-z','--untracked-files=all',*extra],**options)==b'','source_dirty_or_generated')
    if source_vector is None:source_vector=vector;report['sourceFiles']=vector
    need(source_vector==vector,'source_vector_changed')
    report['guards'].append({'label':label,'files':len(vector),'bytes':sum(r['bytes'] for r in vector),'vectorSha256':sha(json.dumps(vector,sort_keys=True).encode()),'passed':True})


def inventory(base):
    rows=[];total=0
    for folder,dirs,files in os.walk(base,followlinks=False):
        for name in sorted(dirs+files):
            budget();p=Path(folder)/name;s=p.lstat();need(s.st_uid==os.getuid(),'inventory_owner_changed')
            r={'path':str(p.relative_to(base)),**identity(p)}
            if stat.S_ISLNK(s.st_mode):
                target=os.readlink(p);need((p.parent/target).resolve().is_relative_to(root),'runtime_symlink_outside_root');r['target']=target
            elif stat.S_ISREG(s.st_mode):r.update(fingerprint(p));total+=s.st_size
            else:need(stat.S_ISDIR(s.st_mode),'unknown_scratch_entry')
            rows.append(r);need(len(rows)<=100000 and total<=LIMIT,'inventory_bound')
    return sorted(rows,key=lambda r:r['path'])


def verify_exports():
    if export_vector is not None:
        need(inventory(root/'source')==export_vector,'exported_source_changed')
    if runtime_vector is not None:
        need(inventory(root/'tools')==runtime_vector,'installed_tools_changed')
    for name,expected in browser_binaries.items():
        need(fingerprint(root/name)==expected,'browser_executable_changed')


def preflight():
    global root,proof,root_id,proof_id,nonce,env,work_end,job_end,prior,export_vector
    need(sys.platform=='linux' and sys.version_info>=(3,11) and sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode,'isolated_linux_python_required')
    need(re.fullmatch('[a-f0-9]{40}',SOURCE or '') and os.environ.get('SOURCE_COMMIT')==SOURCE
         and os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')==REPOSITORY
         and os.environ.get('GITHUB_REF')==BRANCH and os.environ.get('GITHUB_EVENT_NAME')=='push','owned_public_ci_required')
    event=json.loads(read(os.environ['GITHUB_EVENT_PATH'],262144));need(event.get('repository',{}).get('private') is False and event.get('ref')==BRANCH and not event.get('deleted'),'public_owned_push_required')
    clock=os.environ.get('BC_BROWSER_JOB_STARTED_MS','');need(re.fullmatch('[0-9]{13}',clock),'earliest_clock_required')
    remaining=int(clock)/1000+1200-time.time();need(450<=remaining<=1200,'job_window_exhausted')
    work_end=time.monotonic()+min(600,remaining-180);job_end=time.monotonic()+remaining
    parent=Path(os.environ['RUNNER_TEMP']).resolve(strict=True);need(parent.is_dir() and parent!=REPO and REPO not in parent.parents,'runner_temp_invalid')
    need(shutil.disk_usage(parent).free>=6*1024**3,'remote_disk_admission_failed')
    root=Path(tempfile.mkdtemp(prefix='bc-browser-',dir=parent));proof=Path(tempfile.mkdtemp(prefix='bc-browser-proof-',dir=parent));nonce=os.urandom(16).hex()
    for p in (root,proof):p.chmod(0o700);write(p/'.owner',nonce.encode())
    root_id=(root.stat().st_dev,root.stat().st_ino);proof_id=(proof.stat().st_dev,proof.stat().st_ino)
    for name in ('source','tools','browsers','cache','tmp','config','cache/npm','cache/xdg','cache/data','cache/state'):(root/name).mkdir(mode=0o700)
    for name in ('downloads','assets-before','assets-after'):(proof/name).mkdir(mode=0o700)
    for name in ('npmrc','global-npmrc'):write(root/'config'/name,b'')
    node=Path(shutil.which('node') or '').resolve(strict=True);need(node.is_file(),'node_unavailable')
    env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':os.environ['HOME'],'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC',
         'TMPDIR':str(root/'tmp'),'TMP':str(root/'tmp'),'TEMP':str(root/'tmp'),'CI':'true','SOURCE_COMMIT':SOURCE,
         'BC_BROWSER_ROOT':str(root),'BC_BROWSER_PROOF':str(proof),'BC_BROWSER_NONCE':nonce,'BC_BROWSER_CASES':'B01,B02,B03,B04',
         'PLAYWRIGHT_BROWSERS_PATH':str(root/'browsers'),
         'XDG_CACHE_HOME':str(root/'cache/xdg'),'XDG_CONFIG_HOME':str(root/'config'),'XDG_DATA_HOME':str(root/'cache/data'),'XDG_STATE_HOME':str(root/'cache/state'),
         'NPM_CONFIG_CACHE':str(root/'cache/npm'),'NPM_CONFIG_USERCONFIG':str(root/'config/npmrc'),'NPM_CONFIG_GLOBALCONFIG':str(root/'config/global-npmrc'),
         'NPM_CONFIG_REGISTRY':'https://registry.npmjs.org/','NPM_CONFIG_IGNORE_SCRIPTS':'true','NPM_CONFIG_AUDIT':'false','NPM_CONFIG_FUND':'false','NPM_CONFIG_UPDATE_NOTIFIER':'false',
         'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_OPTIONAL_LOCKS':'0','GIT_TERMINAL_PROMPT':'0'}
    with open(os.environ['GITHUB_ENV'],'a') as target:
        target.write(f'BC_BROWSER_PROOF_PATH={proof}\nBC_BROWSER_PROOF_DEV={proof_id[0]}\nBC_BROWSER_PROOF_INO={proof_id[1]}\nBC_BROWSER_OWNER_SHA256={sha(nonce.encode())}\n')
    prior={pid:r['start'] for pid,r in processes().items()}
    report.update({'activationCommit':event.get('after'),'timing':{'earliestStepEpochMs':int(clock),'workSeconds':round(work_end-time.monotonic()),'cleanupReservedSeconds':90,'marginReservedSeconds':90},'environmentKeys':sorted(env),'homePreserved':env['HOME']==os.environ['HOME']})
    guard('before_setup')
    for name in EXPORT:
        target=root/'source'/name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True);write(target,read(REPO/name))
    export_vector=inventory(root/'source');report['sourceExport']={'files':EXPORT,'count':len(EXPORT),'vectorSha256':sha(json.dumps(export_vector,sort_keys=True).encode())}
    need(command('node_version',[str(node),'--version'])==b'v24.22.2\n','node_version_changed');report['node']=str(node)
    command('focused_static_source',[str(node),'scripts/check-source.mjs'])
    return node


def setup(node):
    global runtime_vector
    raw=read(REPO/'tests/fixtures/browser-tool-package-lock.json',32768);lock=json.loads(raw)
    need(len(lock['packages'])==3 and lock['packages']['']['dependencies']=={'playwright':'1.65.0'},'tool_lock_shape')
    expected={'playwright':'sha512-F3AMWcR44qMBt4kq+6Kb6mX7bjGXshktKFOPULd7reED6ZJWevjbNRqysP7q+AATE9kdPEZBibex1BYsvpVoeA==',
              'playwright-core':'sha512-vNSKgH6YqtN7cdT/L334zo0a+YwkrpicyrHJlWWPIm/Q+Nn2SWInil01oT0mbu96U4GgoRtCYQD9CzJQgju+lA=='}
    for name,sri in expected.items():need(lock['packages']['node_modules/'+name]['version']=='1.65.0' and lock['packages']['node_modules/'+name]['integrity']==sri,'tool_lock_pin_changed')
    write(root/'tools/package.json',read(REPO/'tests/fixtures/browser-tool-package.json'));write(root/'tools/package-lock.json',raw)
    command('isolated_frozen_tools',['npm','ci','--prefix',str(root/'tools'),'--ignore-scripts','--omit=optional','--no-audit','--no-fund','--progress=false'],150)
    need(read(root/'tools/package-lock.json')==raw,'tool_lock_rewritten')
    command('install_pinned_chromium',[str(node),str(root/'tools/node_modules/playwright/cli.js'),'install','chromium'],180)
    for p in (root/'browsers').rglob('*'):
        if p.name in ('chrome','headless_shell','chrome-headless-shell','ffmpeg-linux') and p.is_file() and not p.is_symlink():
            browser_binaries[str(p.relative_to(root))]=fingerprint(p)
    need(any('headless' in name for name in browser_binaries),'headless_browser_identity_missing')
    report['browserExecutables']=browser_binaries
    write(proof/'browser-manifest.json',read(root/'tools/node_modules/playwright-core/browsers.json',32768))
    runtime_vector=inventory(root/'tools');report['tools']={'playwright':'1.65.0','lockSha256':sha(raw),'files':len(runtime_vector),'vectorSha256':sha(json.dumps(runtime_vector,sort_keys=True).encode())}
    write(proof/'tools-lock.json',raw)
    guard('after_setup')


def cleanup():
    global cleanup_end
    if root is None:report['cleanup']['rootRemoved']='not_created';return
    cleanup_end=min(time.monotonic()+90,job_end-90)
    try:
        for attempt in range(100):
            rows,live,unknown=observe();need(not unknown,'unknown_root_process_preserved')
            if not live and all(c.poll() is not None and group_absent(c.pid) for c in children):break
            for row in live:
                need(attributed[row['pid']]['start']==row['start'] and row['uid']==os.getuid(),'cleanup_signal_refused')
                try:os.kill(row['pid'],signal.SIGTERM if attempt<60 else signal.SIGKILL)
                except ProcessLookupError:pass
            time.sleep(0.05)
        for child in children:child.wait(timeout=1)
        _,live,unknown=observe();need(not live and not unknown and all(group_absent(c.pid) for c in children),'owned_processes_remaining')
        owner();verify_exports();guard('before_cleanup')
        items=inventory(root);report['cleanup']['scratchInventory']={'entries':len(items),'regularBytes':sum(r['bytes'] for r in items if 'sha256' in r),'vectorSha256':sha(json.dumps(items,sort_keys=True).encode())}
        owner();_,live,unknown=observe();need(not live and not unknown,'predelete_processes_remaining');shutil.rmtree(root);need(not os.path.lexists(root),'scratch_remaining')
        report['cleanup'].update({'rootRemoved':True,'observedOwnedProcesses':list(attributed.values()),'predeleteZeroObserved':True})
        guard('after_cleanup',True);_,live,unknown=observe();need(not live and not unknown,'postdelete_processes_remaining');report['cleanup']['finalZeroObserved']=True
    except Exception as error:report['errors'].append(finite(error));report['cleanup']['rootRemoved']=False


def finite(error):
    message=str(error)
    return message if re.fullmatch('[a-z0-9_]{1,100}',message) else type(error).__name__


def cleanup_proof():
    current=subprocess.run(['git','rev-parse','HEAD'],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout.decode().strip()
    need(current==os.environ.get('SOURCE_COMMIT'),'proof_retirement_source_changed')
    need(subprocess.run(['git','status','--porcelain=v1','-z','--untracked-files=all'],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout==b'','proof_retirement_source_dirty')
    parent=Path(os.environ['RUNNER_TEMP']).resolve(strict=True);p=Path(os.environ['BC_BROWSER_PROOF_PATH'])
    need(p.parent==parent and p.name.startswith('bc-browser-proof-') and p.resolve(strict=True)==p,'proof_path_refused')
    s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==os.getuid() and stat.S_IMODE(s.st_mode)==0o700 and (s.st_dev,s.st_ino)==(int(os.environ['BC_BROWSER_PROOF_DEV']),int(os.environ['BC_BROWSER_PROOF_INO'])),'proof_owner_changed')
    marker=p/'.owner';need(stat.S_IMODE(marker.lstat().st_mode)==0o600 and sha(read(marker,32))==os.environ['BC_BROWSER_OWNER_SHA256'],'proof_marker_changed')
    count=total=0
    for folder,dirs,files in os.walk(p,followlinks=False):
        for name in dirs+files:
            q=Path(folder)/name;st=q.lstat();need(st.st_uid==os.getuid() and not stat.S_ISLNK(st.st_mode),'proof_entry_refused');count+=1
            if stat.S_ISREG(st.st_mode):need(st.st_size<=2*1024**2,'proof_file_bound');total+=st.st_size
            else:need(stat.S_ISDIR(st.st_mode),'proof_type_refused')
            need(count<=200 and total<=12*1024**2,'proof_total_bound')
    result=subprocess.run(['lsof','-nP','+D',str(p)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
    need(result.returncode==1 and result.stdout==result.stderr==b'','proof_openers_unverified')
    need((p.lstat().st_dev,p.lstat().st_ino)==(s.st_dev,s.st_ino),'proof_predelete_changed');shutil.rmtree(p);need(not os.path.lexists(p),'proof_remaining')
    print('BC_BROWSER_PROOF_CLEANUP '+json.dumps({'sourceCommit':current,'sourceClean':True,'removed':True,'entries':count,'bytes':total,'openersObserved':0,'absenceReadback':True}))


def main():
    completed=False
    def interrupt(_signal,_frame):
        global stopped
        stopped=True
    for number in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(number,interrupt)
    try:
        node=preflight();setup(node)
        command('four_hosted_preview_cases',[str(node),str(root/'source/tests/e2e/preview-browser.mjs')],240,allowed=(0,1))
        browser=json.loads(read(proof/'browser-results.json',1024**2));report['browserResults']=browser
        need(browser['passed'] and len(browser['cases'])==4 and all(c['passed'] for c in browser['cases']),'browser_cases_failed')
        verify_exports();guard('after_browser');completed=True
    except Exception as error:
        report['errors'].append(finite(error));tb=error.__traceback__
        while tb and tb.tb_next:tb=tb.tb_next
        report['errorLocation']=None if tb is None else {'file':Path(tb.tb_frame.f_code.co_filename).name,'line':tb.tb_lineno}
    finally:cleanup()
    if proof is None:
        print('BC_BROWSER_CONTROLLER_RECEIPT '+json.dumps(report));return 1
    if 'browserResults' not in report and (proof/'browser-results.json').is_file():report['browserResults']=json.loads(read(proof/'browser-results.json',1024**2))
    report['passed']=bool(completed and not stopped and not report['errors'] and report['cleanup'].get('rootRemoved') is True and report['cleanup'].get('finalZeroObserved') and len(report['guards'])==5)
    catalog=[]
    for p in sorted(proof.rglob('*')):
        if p.is_file() and p.name!='.owner':catalog.append({'path':str(p.relative_to(proof)),**fingerprint(p)})
    need(len(catalog)<=200 and sum(p['bytes'] for p in catalog)<=12*1024**2,'proof_catalog_bound')
    report['proofCatalog']=catalog
    raw=json.dumps(report,sort_keys=True,separators=(',',':'),allow_nan=False).encode();need(len(raw)<=8*1024**2,'report_bound')
    write(proof/'controller-report.json',raw+b'\n',8*1024**2)
    print('BC_BROWSER_CONTROLLER_RECEIPT_BEGIN');print(raw.decode());print('BC_BROWSER_CONTROLLER_RECEIPT_END')
    return 0 if report['passed'] else 1


if __name__=='__main__':
    if sys.argv[1:]==['--cleanup-proof']:cleanup_proof()
    else:raise SystemExit(main())
