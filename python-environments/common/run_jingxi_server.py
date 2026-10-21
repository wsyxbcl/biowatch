"""Biowatch protocol adapter for the immutable Heinishi local delivery."""
import argparse
import hashlib
import importlib.util
from pathlib import Path
import sys
import litserve as ls

MANIFEST_SHA256 = 'f91b10dd27687d44641ffd7b1fdb72102552f01844a4a0c31652d1a738791e9b'
APP_VERSION = '0.0.1'
VIDEO_SUFFIXES = {'.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v'}

# Import under a private name: YOLO needs its own top-level utils package.
_utils_spec = importlib.util.spec_from_file_location(
    'biowatch_video_utils', Path(__file__).with_name('utils.py'))
_video_utils = importlib.util.module_from_spec(_utils_spec)
_utils_spec.loader.exec_module(_video_utils)


def adapt_runner_result(raw):
    classification = raw.get('classification') or {}
    return {
        'filepath': raw['filepath'],
        'model_version': APP_VERSION,
        'prediction': 'error' if raw['status'] == 'error' else classification.get('raw_label', 'unlabeled'),
        'detections': raw.get('detections', []),
        'jingxi': raw,
        **({'prediction_score': classification['raw_score']} if classification else {}),
        **({'error': raw.get('error')} if raw['status'] == 'error' else {}),
    }


def predict_image(runner, filepath):
    if Path(filepath).suffix.lower() in VIDEO_SUFFIXES:
        return adapt_runner_result({'filepath': filepath, 'status': 'error',
                                    'error': {'message': 'Heinishi supports images only'}})
    return adapt_runner_result(runner.predict(filepath))


def prepare_bundle_import_path(bundle):
    # YOLO imports a top-level utils package; Biowatch's utils.py must not shadow it.
    wrapper_dir = Path(__file__).resolve().parent
    sys.path[:] = [p for p in sys.path if Path(p).resolve() != wrapper_dir]
    sys.path.insert(0, str(bundle))


def move_runner_to_device(runner, device):
    # Load the verified CPU delivery unchanged, then migrate its existing FP32 models.
    runner.classifier.model.to(device)
    runner.classifier.device = device
    detector = runner.detector.model
    if detector.half_precision:
        raise ValueError('Heinishi requires FP32 detection')
    detector.model.to(device)
    detector.device = device
    return runner


def resolve_device(device):
    import torch
    if device == 'auto':
        return 'cuda:0' if torch.cuda.is_available() else 'cpu'
    target = torch.device(device)
    if target.type not in ('cpu', 'cuda'):
        raise ValueError('Heinishi supports CPU or CUDA')
    if target.type == 'cuda' and not torch.cuda.is_available():
        raise ValueError('CUDA requested but unavailable')
    return str(target)


def load_runner(bundle, device='cpu'):
    bundle = Path(bundle).resolve()
    if hashlib.sha256((bundle / 'manifest.json').read_bytes()).hexdigest() != MANIFEST_SHA256:
        raise ValueError('Unexpected Heinishi delivery manifest')
    # Verify code bytes BEFORE importing executable code from the local bundle.
    import json
    manifest = json.loads((bundle / 'manifest.json').read_text(encoding='utf-8'))
    for filename, asset in manifest['files'].items():
        path = (bundle / filename).resolve()
        if not path.is_relative_to(bundle):
            raise ValueError('Unsafe bundle asset path')
        if hashlib.sha256(path.read_bytes()).hexdigest() != asset['sha256']:
            raise ValueError('Bundle asset hash mismatch')
    prepare_bundle_import_path(bundle)
    spec = importlib.util.spec_from_file_location('heinishi_delivery_runner', bundle / 'runner.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    runner = module.Runner(bundle, device='cpu')
    return move_runner_to_device(runner, device) if device != 'cpu' else runner


class HeinishiAPI(ls.LitAPI, _video_utils.VideoCapableLitAPI):
    def __init__(self, bundle, threads=4, device='auto'):
        super().__init__(api_path='/predict', stream=True)
        self.bundle = bundle
        self.threads = threads
        self.requested_device = device

    def setup(self, device):
        import torch
        torch.set_num_threads(self.threads)
        self.runtime_device = resolve_device(self.requested_device)
        self.runner = load_runner(self.bundle, self.runtime_device)

    def decode_request(self, request):
        return request

    def _predict_single_image(self, filepath, **kwargs):
        result = predict_image(self.runner, filepath)
        result['heinishiRuntime'] = {
            'adapterVersion': APP_VERSION,
            'device': getattr(self, 'runtime_device', 'cpu'),
            'precision': 'float32',
        }
        return {'predictions': [result]}

    def predict(self, request, **kwargs):
        yield from self.predict_with_video_support(request, **kwargs)

    def _predict_video(self, video_path, sample_fps=1, **kwargs):
        for result in super()._predict_video(video_path, sample_fps, **kwargs):
            for prediction in result['predictions']:
                # Upstream yields sampled ordinals; DB timestamps require source frame indices.
                interval = max(1, int(prediction['metadata']['fps'] / sample_fps))
                prediction['frame_number'] *= interval
            yield result

    def encode_response(self, output):
        for item in output:
            yield {'output': item}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--device', default='auto')
    args = parser.parse_args()
    api = HeinishiAPI(args.bundle, args.threads, args.device)
    # One worker owns both models; device selection is handled by the adapter.
    server = ls.LitServer(api, accelerator='cpu', devices=1, workers_per_device=1,
                         timeout=120, enable_shutdown_api=True,
                         model_metadata={'name': 'Heinishi Test type 001', 'type': 'maze-speciesnet-jingxi'})
    server.run(host='127.0.0.1', port=args.port, generate_client_file=False)


if __name__ == '__main__':
    main()
