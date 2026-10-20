"""Smoke check for a built Heinishi environment (no model weights needed)."""
import sys

import cv2
import litserve
import megadetector
import timm
import torch
import torchvision
from importlib.metadata import version

assert sys.version_info[:2] == (3, 12), sys.version
assert torch.__version__.startswith('2.11.0'), torch.__version__
assert torch.version.cuda == '12.8', torch.version.cuda
for name in ('megadetector', 'ultralytics-yolov5', 'timm', 'litserve'):
    print(name, version(name))
print('torch', torch.__version__, 'torchvision', torchvision.__version__, 'cv2', cv2.__version__)
print('cuda available:', torch.cuda.is_available())
if torch.cuda.is_available():
    print('device:', torch.cuda.get_device_name(0), 'capability:', torch.cuda.get_device_capability(0))
    x = torch.randn(64, 64, device='cuda')
    assert torch.isfinite(x @ x).all()
print('OK', litserve.__name__, megadetector.__name__, timm.__name__)
