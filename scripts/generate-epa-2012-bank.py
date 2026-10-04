"""Build VALOR's compact, source-traceable 2012 vehicle bank.

Input is the official EPA/DOE 2012 Fuel Economy Guide workbook. The generated
JSON intentionally keeps only configurations released before 2012-01-01.
Purchase prices and gameplay-only capacities are estimates because the EPA
workbook contains fuel costs but not MSRP, tank size, or cargo/passenger data;
every generated record labels that limitation explicitly.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pandas as pd


CUTOFF = pd.Timestamp("2012-01-01")
SOURCE_URL = "https://www.fueleconomy.gov/feg/epadata/12data.zip"

CLASS_PRICE = {
    "two seaters": 28_000,
    "minicompact cars": 17_000,
    "subcompact cars": 18_000,
    "compact cars": 20_500,
    "midsize cars": 24_500,
    "large cars": 30_000,
    "small station wagons": 22_000,
    "midsize station wagons": 26_000,
    "small pickup trucks": 24_000,
    "standard pickup trucks": 28_000,
    "minivans": 28_000,
    "vans, passenger type": 30_000,
    "vans, cargo type": 26_000,
    "special purpose vehicle": 35_000,
}

BRAND_MULTIPLIER = {
    "acura": 1.35,
    "aston martin": 5.0,
    "audi": 1.6,
    "bentley": 8.0,
    "bmw": 1.7,
    "cadillac": 1.5,
    "ferrari": 8.0,
    "infiniti": 1.4,
    "jaguar": 2.0,
    "lamborghini": 9.0,
    "land rover": 2.0,
    "lexus": 1.6,
    "lincoln": 1.4,
    "lotus": 2.3,
    "maserati": 4.0,
    "mercedes": 1.8,
    "porsche": 2.5,
    "rolls-royce": 12.0,
    "saab": 1.25,
    "volvo": 1.4,
}


def clean(value: object) -> str:
    return "" if pd.isna(value) else " ".join(str(value).split())


def number(value: object, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        return fallback if math.isnan(parsed) else parsed
    except (TypeError, ValueError):
        return fallback


def vehicle_category(class_name: str) -> str:
    value = class_name.lower()
    if "pickup" in value:
        return "truck"
    if "van" in value:
        return "bus" if "passenger" in value else "truck"
    return "car"


def passenger_capacity(class_name: str) -> int:
    value = class_name.lower()
    if "two seater" in value:
        return 2
    if "pickup" in value:
        return 5
    if "van" in value or "minivan" in value:
        return 7
    return 5


def cargo_capacity_kg(class_name: str) -> int:
    value = class_name.lower()
    if "cargo" in value:
        return 900
    if "pickup" in value:
        return 650
    if "van" in value or "minivan" in value:
        return 450
    if "station wagon" in value:
        return 350
    if "two seater" in value:
        return 90
    return 250


def handling_modifier(class_name: str) -> float:
    value = class_name.lower()
    if "two seater" in value:
        return 6
    if any(term in value for term in ("minicompact", "subcompact", "compact")):
        return 4
    if "midsize" in value:
        return 2
    if "large" in value:
        return -1
    if any(term in value for term in ("pickup", "van", "special purpose")):
        return -2
    return 0


def fuel_tank_liters(class_name: str, displacement: float) -> float:
    """Conservative class/engine estimate used only to turn EPA economy into fuel use."""
    value = class_name.lower()
    if "pickup" in value or "cargo" in value:
        base = 90
    elif "van" in value or "special purpose" in value:
        base = 80
    elif "two seater" in value:
        base = 60
    elif "large" in value:
        base = 70
    elif "midsize" in value:
        base = 62
    elif any(term in value for term in ("minicompact", "subcompact", "compact")):
        base = 48
    else:
        base = 58
    return round(max(base, 35 + displacement * 8), 1)


def price_estimate(brand: str, class_name: str, displacement: float, cylinders: float) -> int:
    key = class_name.lower()
    base = next((price for label, price in CLASS_PRICE.items() if label in key), 25_000)
    brand_key = brand.lower()
    multiplier = next((value for label, value in BRAND_MULTIPLIER.items() if label in brand_key), 1.0)
    engine = 1 + max(0, displacement - 2) * 0.08 + max(0, cylinders - 4) * 0.04
    return int(round(base * multiplier * engine / 100) * 10_000)


def liters_per_100km(mpg: float) -> float:
    return round(235.214583 / mpg, 2) if mpg > 0 else 0


def main(source: Path, destination: Path) -> None:
    frame = pd.read_excel(source, sheet_name="FEguide")
    frame.columns = [str(column).strip() for column in frame.columns]
    frame["Release Date"] = pd.to_datetime(frame["Release Date"], errors="coerce")
    frame = frame.loc[frame["Release Date"].notna() & (frame["Release Date"] < CUTOFF)].copy()
    records: list[dict[str, object]] = []
    seen: set[tuple[object, ...]] = set()
    for _, row in frame.iterrows():
        brand = clean(row["Division"]).title()
        model = clean(row["Carline"])
        class_name = clean(row["Carline Class Desc"])
        transmission = clean(row["Trans in FE Guide (MFR entered for data entered after May 13 2011)"])
        drive = clean(row["Drive Desc"])
        displacement = number(row["Eng Displ"])
        cylinders = number(row["# Cyl"])
        combined_mpg = number(row["Comb FE (Guide) - Conventional Fuel"])
        record_id = int(number(row["EPA FE Label Dataset ID"]))
        key = (brand, model, displacement, cylinders, transmission, drive, combined_mpg)
        if key in seen or not brand or not model or not record_id:
            continue
        seen.add(key)
        city_mpg = number(row["City FE (Guide) - Conventional Fuel"])
        highway_mpg = number(row["Hwy FE (Guide) - Conventional Fuel"])
        fuel_description = clean(row["Fuel Usage Desc - Conventional Fuel"])
        category = vehicle_category(class_name)
        heavy = any(term in class_name.lower() for term in ("pickup", "van", "special purpose"))
        estimate = price_estimate(brand, class_name, displacement, cylinders)
        variant = ", ".join(part for part in (
            f"{displacement:g} L" if displacement else "",
            f"{int(cylinders)} cyl" if cylinders else "",
            transmission,
            drive,
        ) if part)
        records.append({
            "id": f"vehicle:epa-{record_id}",
            "kind": "vehicle",
            "category": category,
            "name": f"2012 {brand} {model}",
            "variant": variant,
            "introducedOn": row["Release Date"].date().isoformat(),
            "price2012Cents": estimate,
            "priceBasis": "estimated-2012-new-retail",
            "priceConfidence": "low",
            "source": {
                "label": "EPA/DOE 2012 Fuel Economy Guide datafile",
                "url": SOURCE_URL,
                "recordId": str(record_id),
                "notes": "EPA supplies identity, release date, engine, transmission, drivetrain, MPG, and annual fuel cost. Price, tank size, passenger/cargo capacity, handling, and durability are labeled gameplay estimates because the workbook does not supply them.",
            },
            "template": {
                "kind": "vehicle",
                "name": f"2012 {brand} {model}",
                "visibility": "creator",
                "data": {
                    "description": f"2012 model configuration: {variant}. EPA class: {class_name}.",
                    "tags": ["2012-master-bank", "epa-2012", category, class_name.lower()],
                    "bankId": f"vehicle:epa-{record_id}",
                    "introducedOn": row["Release Date"].date().isoformat(),
                    "price": estimate,
                    "priceBasis": "estimated-2012-new-retail",
                    "priceSource": SOURCE_URL,
                    "priceConfidence": "low",
                    "make": brand,
                    "model": model,
                    "year": 2012,
                    "category": category,
                    "fuelType": fuel_description or "Gasoline",
                    "fuelTankLiters": fuel_tank_liters(class_name, displacement),
                    "fuelEconomyCityLPer100Km": liters_per_100km(city_mpg),
                    "fuelEconomyHighwayLPer100Km": liters_per_100km(highway_mpg),
                    "fuelEconomyCombinedLPer100Km": liters_per_100km(combined_mpg),
                    "epaCityMpg": city_mpg,
                    "epaHighwayMpg": highway_mpg,
                    "epaCombinedMpg": combined_mpg,
                    "annualFuelCost2012Cents": int(number(row["Annual Fuel1 Cost - Conventional Fuel"]) * 100),
                    "engineDisplacementLiters": displacement,
                    "cylinders": int(cylinders),
                    "transmission": transmission,
                    "drivetrain": drive,
                    "capacity": passenger_capacity(class_name),
                    "trunkCapacity": cargo_capacity_kg(class_name),
                    "handlingModifier": handling_modifier(class_name),
                    "durability": 70 if heavy else 50,
                    "components": {"engine": 100, "tires": 100, "brakes": 100},
                },
            },
        })
    records.sort(key=lambda record: (str(record["name"]), str(record["variant"]), str(record["id"])))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {len(records)} qualifying vehicle configurations to {destination}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: generate-epa-2012-bank.py SOURCE.xlsx DESTINATION.json")
    main(Path(sys.argv[1]), Path(sys.argv[2]))
