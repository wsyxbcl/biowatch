"""Opt-in local CPU/CUDA comparison and real-model video smoke test."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile

import cv2
import torch


def main():
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location(
        'heinishi_validation_server', root / 'python-environments/common/run_jingxi_server.py')
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    bundle = Path(os.environ['MAZE_JINGXI_BUNDLE_PATH'])
    samples = Path(os.environ['HEINISHI_SAMPLE_DIR'])
    assert torch.cuda.is_available(), 'CUDA is required for this validation'
    torch.set_num_threads(4)
    runner = server.load_runner(bundle)
    names = ['P001.jpg', 'P067.jpg', 'P075.jpg']
    cpu = [runner.predict(samples / name) for name in names]
    server.move_runner_to_device(runner, 'cuda:0')
    assert str(next(runner.classifier.model.parameters()).device) == 'cuda:0'
    assert str(next(runner.detector.model.model.parameters()).device) == 'cuda:0'
    gpu = [runner.predict(samples / name) for name in names]
    differences = []
    for name, a, b in zip(names, cpu, gpu):
        assert a['status'] == b['status'] == 'classified', (a, b)
        assert a['classification']['raw_index'] == b['classification']['raw_index'], name
        differences.append({
            'image': name,
            'raw_label': b['classification']['raw_label'],
            'max_probability_difference': max(abs(x-y) for x,y in zip(
                a['classification']['probabilities'], b['classification']['probabilities'])),
            'cpu_selected_index': a['selected_detection_index'],
            'cuda_selected_index': b['selected_detection_index'],
        })
    output = Path(tempfile.mkdtemp(prefix='heinishi-runtime-'))
    video = output / 'sample.avi'
    image = cv2.imread(str(samples / names[0]))
    height, width = image.shape[:2]
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*'MJPG'), 2, (width, height))
    assert writer.isOpened()
    for _ in range(6):
        writer.write(image)
    writer.release()
    api = server.HeinishiAPI(bundle)
    api.runner = runner
    api.runtime_device = 'cuda:0'
    frames = [p for result in api.predict({'instances': [{'filepath': str(video), 'sample_fps': 1}]})
              for p in result['predictions']]
    assert [f['frame_number'] for f in frames] == [0, 2, 4]
    assert all(f['jingxi']['status'] == 'classified' for f in frames), frames
    assert all(f['filepath'] == str(video) for f in frames)
    report = {'device': torch.cuda.get_device_name(0), 'torch': torch.__version__,
              'differences': differences, 'video': str(video), 'frames': frames}
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'output': str(output), 'differences': differences,
                      'video_frames': [f['frame_number'] for f in frames]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
