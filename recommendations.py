from functools import lru_cache
from pathlib import Path

import joblib
import pandas as pd


MODEL_FEATURES = ("Water Temperature (°C)", "pH")
MODEL_CLASSES = ("Critical", "Optimal", "Warning")
RECOMMENDATION_MESSAGES = {
    "Critical": "The model classified water quality as critical. Inspect pond conditions and take corrective action promptly.",
    "Warning": "The model detected a water quality warning. Review conditions and monitor closely.",
    "Optimal": "The model classified water quality as optimal. Continue routine monitoring.",
}


class RecommendationModelError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _load_model_artifacts():
    model_directory = Path(__file__).resolve().parent / "model_joblib"
    try:
        model = joblib.load(model_directory / "best_water_quality_model.joblib")
        label_encoder = joblib.load(model_directory / "label_encoder.joblib")
    except (
        AttributeError,
        EOFError,
        ImportError,
        OSError,
        TypeError,
        ValueError,
    ) as error:
        raise RecommendationModelError(
            "Unable to load the water quality recommendation model."
        ) from error

    model_features = tuple(str(name) for name in model.feature_names_in_)
    encoder_classes = tuple(str(label) for label in label_encoder.classes_)
    if model_features != MODEL_FEATURES or encoder_classes != MODEL_CLASSES:
        raise RecommendationModelError(
            "The model artifacts do not match the expected input features or classes."
        )

    return model, label_encoder


def predict_recommendation(temperature, ph):
    model, label_encoder = _load_model_artifacts()
    features = pd.DataFrame(
        [[temperature, ph]],
        columns=MODEL_FEATURES,
    )
    try:
        encoded_prediction = model.predict(features)
        classification = str(label_encoder.inverse_transform(encoded_prediction)[0])
    except (AttributeError, IndexError, TypeError, ValueError) as error:
        raise RecommendationModelError(
            "Unable to generate a water quality recommendation."
        ) from error

    message = RECOMMENDATION_MESSAGES.get(classification)
    if message is None:
        raise RecommendationModelError(
            "The model returned an unsupported water quality classification."
        )

    return {"classification": classification, "recommendation": message}
