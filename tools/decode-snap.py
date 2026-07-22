import base64
import re
import sys

src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding='utf-8', errors='ignore').read().strip()
m = re.search(r'data:image/png;base64,([A-Za-z0-9+/=]+)', text)
if not m:
    print('no data url found')
    sys.exit(1)
open(dst, 'wb').write(base64.b64decode(m.group(1)))
print('wrote', dst)
