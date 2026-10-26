import importlib
import os

print('=== vision/ assets ===')
d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'vision')
for name in sorted(os.listdir(d)):
    p = os.path.join(d, name)
    if os.path.isfile(p):
        print(f'  {os.path.getsize(p):>10,}  {name}')

print('\n=== python libs ===')
for m in ['numpy', 'cv2', 'PIL', 'sklearn', 'scipy', 'skimage', 'torch',
          'tensorflow', 'pytesseract', 'onnxruntime', 'joblib']:
    try:
        mod = importlib.import_module(m)
        print(f'  {m:14s} YES  {getattr(mod, "__version__", "?")}')
    except Exception:
        print(f'  {m:14s} no')