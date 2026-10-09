"""JSON transport for the isolated System 11 console; no production game adapters."""
import json
import sys
from time_schedule_calendar import PINNED_TZDATA, VERSION, TimeScheduleCalendar, default_state, pinned_zone


def execute(message: dict) -> dict:
    snapshot = message.get("snapshot")
    state = TimeScheduleCalendar.import_state(snapshot) if snapshot else default_state(message["branch_id"])
    result = None
    if message["operation"] == "advance":
        original = next((v for v in state.advance_intent.values() if v["command_id"] == message["command_id"]), None)
        start = original["start_ms"] if original else state.world_clock["instant_ms"]
        request = {
            "command_id": message["command_id"], "branch_id": message["branch_id"],
            "actor_id": "mock:pc", "authorization_ref": "mock:authorization",
            "expected_clock_revision": message["expected_clock_revision"],
            "causation_id": "console:" + message["command_id"], "kind": "wait_duration",
            "duration_ms": message["duration_ms"], "maximum_horizon_ms": start + message["duration_ms"],
            "location_ref": "mock:location",
        }
        result = TimeScheduleCalendar.advance(state, request)
    elif message["operation"] != "inspect":
        raise ValueError("unsupported_operation")
    return {
        "snapshot": TimeScheduleCalendar.export_state(state),
        "clock": TimeScheduleCalendar.project_clock(state) | {"branch_id": state.world_clock["branch_id"]},
        "result": result,
    }


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--probe"]:
            pinned_zone("America/Los_Angeles", PINNED_TZDATA)
            response = {"ready": True, "version": VERSION, "tzdata_version": PINNED_TZDATA}
        else:
            raw = sys.stdin.buffer.read(4_194_305)
            if len(raw) > 4_194_304:
                raise ValueError("request_too_large")
            response = execute(json.loads(raw))
        sys.stdout.write(json.dumps(response, separators=(",", ":"), allow_nan=False))
    except Exception:
        sys.stdout.write('{"error":"system11_worker_failed"}')
        sys.exit(1)
