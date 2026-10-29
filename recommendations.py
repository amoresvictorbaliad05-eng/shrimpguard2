from functools import lru_cache
from pathlib import Path

import joblib
import pandas as pd


MODEL_FEATURES = ("Water Temperature (°C)", "pH")
MODEL_CLASSES = ("Critical", "Optimal", "Warning")
TEMPERATURE_RANGE = (26, 32)
PH_RANGE = (7.5, 8.5)


class RecommendationModelError(RuntimeError):
    pass


def _reading_findings(temperature, ph):
    findings = []
    minimum_temperature, maximum_temperature = TEMPERATURE_RANGE
    minimum_ph, maximum_ph = PH_RANGE

    if temperature < minimum_temperature:
        findings.append(
            f"Temperature is {temperature:g} °C, below the "
            f"{minimum_temperature}–{maximum_temperature} °C reference range"
        )
    elif temperature > maximum_temperature:
        findings.append(
            f"Temperature is {temperature:g} °C, above the "
            f"{minimum_temperature}–{maximum_temperature} °C reference range"
        )

    if ph < minimum_ph:
        findings.append(
            f"pH is {ph:g}, below the {minimum_ph}–{maximum_ph} reference range"
        )
    elif ph > maximum_ph:
        findings.append(
            f"pH is {ph:g}, above the {minimum_ph}–{maximum_ph} reference range"
        )

    return findings


def _build_recommendation(classification, temperature, ph):
    findings = _reading_findings(temperature, ph)
    if classification == "Critical":
        if findings:
            details = "; ".join(findings)
            recommendation = (
                f"The model predicts Critical. {details}. Verify the readings and "
                "follow your farm's protocol to correct conditions gradually."
            )
        else:
            recommendation = (
                "The model predicts Critical, although temperature and pH are within "
                "their reference ranges. Verify both readings and inspect other pond "
                "conditions promptly."
        )
    elif classification == "Warning":
        if findings:
            details = "; ".join(findings)
            recommendation = (
                f"The model predicts Warning. {details}. Recheck the measurements "
                "and follow your farm's protocol."
            )
        else:
            recommendation = (
                "The model predicts Warning, although temperature and pH are within "
                "their reference ranges. Repeat the measurements and continue close "
                "monitoring."
            )
    elif findings:
        details = "; ".join(findings)
        recommendation = (
            f"The model predicts Optimal, but {details}. Verify the measurements "
            "and do not treat this result as an all-clear."
        )
    else:
        recommendation = (
            "The model predicts Optimal. Keep conditions stable and continue routine "
            "monitoring."
        )

    return {"classification": classification, "recommendation": recommendation}


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

    if classification not in MODEL_CLASSES:
        raise RecommendationModelError(
            "The model returned an unsupported water quality classification."
        )

    return _build_recommendation(classification, temperature, ph)
