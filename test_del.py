import os, json, sys
sys.path.insert(0, '/root/smart_agent')

os.chdir('/root/smart_agent')

# 手动模拟 _get_output_dir 和 _safe_file_path
from src.core.config import get_config

cfg = get_config()
output_dir = os.path.abspath(cfg.tools.output_dir)
print(f"output_dir = {output_dir}")
print(f"exists = {os.path.isdir(output_dir)}")

# 模拟 _list_output_files
for root, dirs, filenames in os.walk(output_dir):
    for fname in filenames[:5]:
        abs_path = os.path.join(root, fname)
        rel_path = os.path.relpath(abs_path, output_dir).replace("\\", "/")
        
        # 模拟 _safe_file_path
        filepath = rel_path
        a = os.path.abspath(filepath if os.path.isabs(filepath) else os.path.join(output_dir, filepath))
        r = os.path.realpath(a)
        ro = os.path.realpath(output_dir)
        ok = r.startswith(ro + os.sep) or r == ro
        exists = os.path.isfile(r)
        status = "OK DELETE" if (ok and exists) else f"SKIP (safe={ok}, exists={exists})"
        print(f"rel={rel_path} -> {status}")
