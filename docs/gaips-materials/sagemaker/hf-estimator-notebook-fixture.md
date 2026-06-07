# SageMaker Hugging Face Estimator Notebook Fixture

This is a sanitized review fixture, not a runnable AWS notebook.

```python
from sagemaker.huggingface import HuggingFace

estimator = HuggingFace(
    entry_point="train.py",
    source_dir="src",
    instance_type="ml.g5.xlarge",
    instance_count=1,
    role="arn:aws:iam::111122223333:role/GAIPS-SageMaker-Execution-Fixture",
    transformers_version="4.36",
    pytorch_version="2.1",
    py_version="py310",
    hyperparameters={"epochs": 1, "train_batch_size": 4},
    metric_definitions=[{"Name": "eval_loss", "Regex": "eval_loss = ([0-9.]+)"}],
    output_path="s3://gaips-fixture-output/models/",
)

# Fixture mode: do not run fit(). Review IAM, S3, metrics, cost controls, and training boundary.
# estimator.fit({"train": "s3://gaips-fixture-input/train/"})
```

Expected review findings:

- IAM role is scoped to fixture buckets only.
- Training script boundary is explicit: `entry_point=train.py`, `source_dir=src`.
- Metrics are defined and reviewable.
- Live job launch requires instructor approval and cost guardrails.
