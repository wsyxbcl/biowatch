import importlib.util
from pathlib import Path
import unittest
import sys
from types import SimpleNamespace
from unittest.mock import Mock
import tempfile


class JingxiServerTests(unittest.TestCase):
    def test_device_migration_keeps_fp32_and_moves_both_models(self):
        module = self.module()
        classifier_model = Mock()
        detector_model = Mock()
        runner = SimpleNamespace(
            classifier=SimpleNamespace(model=classifier_model, device='cpu'),
            detector=SimpleNamespace(model=SimpleNamespace(model=detector_model, device='cpu', half_precision=False)))
        module.move_runner_to_device(runner, 'cuda:0')
        classifier_model.to.assert_called_once_with('cuda:0')
        detector_model.to.assert_called_once_with('cuda:0')
        self.assertEqual(str(runner.classifier.device), 'cuda:0')
        self.assertEqual(str(runner.detector.model.device), 'cuda:0')
        self.assertFalse(runner.detector.model.half_precision)

    def test_video_uses_upstream_frames_and_original_filepath(self):
        import cv2
        import numpy as np
        module = self.module()
        api = module.HeinishiAPI('/unused')
        class FakeRunner:
            def predict(self, filepath):
                self.last_path = filepath
                return {'filepath': filepath, 'status': 'no_animal', 'detections': []}
        api.runner = FakeRunner()
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'test.avi')
            writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*'MJPG'), 2, (64, 64))
            self.assertTrue(writer.isOpened())
            for _ in range(4):
                writer.write(np.zeros((64, 64, 3), dtype=np.uint8))
            writer.release()
            decoded = api.decode_request({'instances': [{'filepath': path, 'sample_fps': 1}]})
            frames = [item['predictions'][0] for item in api.predict(decoded)]
            self.assertEqual([f['frame_number'] for f in frames], [0, 2])
            self.assertTrue(all(f['filepath'] == path for f in frames))
            self.assertFalse(Path(api.runner.last_path).exists())

    def test_bundle_import_excludes_biowatch_utils_directory(self):
        module = self.module()
        original = sys.path[:]
        try:
            directory = str(Path(module.__file__).parent)
            sys.path.insert(0, directory)
            module.prepare_bundle_import_path(Path('/tmp/trusted-bundle'))
            self.assertNotIn(directory, sys.path)
            self.assertEqual(sys.path[0], '/tmp/trusted-bundle')
        finally:
            sys.path[:] = original

    def module(self):
        path = Path(__file__).parents[1] / 'run_jingxi_server.py'
        spec = importlib.util.spec_from_file_location('jingxi_server', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_envelope_preserves_delivery_version_and_original(self):
        module = self.module()
        raw = {'filepath': '/tmp/a.jpg', 'model_version': '0.1.0-experimental',
               'status': 'classified', 'classification': {'raw_label': 'test', 'raw_score': .7},
               'detections': [], 'selected_detection_index': 0}
        result = module.adapt_runner_result(raw)
        self.assertEqual(result['model_version'], '0.0.1')
        self.assertIs(result['jingxi'], raw)
        self.assertEqual(result['jingxi']['model_version'], '0.1.0-experimental')

    def test_unclassified_is_not_blank_and_errors_are_explicit(self):
        module = self.module()
        raw = {'filepath': '/tmp/a.jpg', 'status': 'no_animal', 'detections': []}
        self.assertEqual(module.adapt_runner_result(raw)['prediction'], 'unlabeled')
        raw.update(status='error', error={'message': 'broken'})
        self.assertEqual(module.adapt_runner_result(raw)['prediction'], 'error')

    def test_predict_reuses_runner_and_rejects_video(self):
        module = self.module()
        class FakeRunner:
            def predict(self, filepath):
                return {'filepath': filepath, 'status': 'no_animal', 'detections': []}
        runner = FakeRunner()
        self.assertEqual(module.predict_image(runner, '/tmp/a.jpg')['prediction'], 'unlabeled')
        self.assertEqual(module.predict_image(runner, '/tmp/a.mp4')['prediction'], 'error')


if __name__ == '__main__':
    unittest.main()
