import os
import tempfile

_TEST_DATA_DIR = tempfile.TemporaryDirectory(prefix="vodex-tests-")
os.environ["DATA_DIR"] = _TEST_DATA_DIR.name
