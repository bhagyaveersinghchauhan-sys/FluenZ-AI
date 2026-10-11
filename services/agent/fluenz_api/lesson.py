import json
import re
from collections import deque
from difflib import SequenceMatcher
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .scenarios import ScenarioSelection, UiLanguage, scenario_targets


EVENT_TOPIC = "fluenz.lesson.v1"
COMMAND_TOPIC = "fluenz.lesson.command.v1"


class LessonPhase(str, Enum):
    REPEAT = "repeat_after_me"
    OBJECT = "name_the_object"
    COMPLETE = "completed"
    SKIPPED = "skipped"


class LessonOutcome(str, Enum):
    PROMPT = "prompt"
    RETRY = "retry"
    UNCLEAR = "unclear"
    ACCEPTED = "accepted"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class LessonStateEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    type: Literal["lesson_state"] = "lesson_state"
    phase: LessonPhase
    outcome: LessonOutcome
    attempt: int = Field(ge=1, le=99)
    failed_attempts: int = Field(ge=0, le=99)


class LessonCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    type: Literal["lesson_command"]
    action: Literal["replay"]


def parse_lesson_command(payload: bytes) -> LessonCommand | None:
    try:
        value = json.loads(payload)
        return LessonCommand.model_validate(value)
    except (UnicodeDecodeError, json.JSONDecodeError, ValidationError):
        return None


def sentence_words(value: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)*", value.casefold())


def matches_target_sentence(target: str, transcript: str) -> bool:
    return sentence_words(target) == sentence_words(transcript)


def target_sentence_feedback(target: str, transcript: str) -> str:
    expected = sentence_words(target)
    received = sentence_words(transcript)
    differences: list[str] = []

    for operation, expected_start, expected_end, received_start, received_end in (
        SequenceMatcher(a=expected, b=received, autojunk=False).get_opcodes()
    ):
        if operation == "replace":
            substitutions = min(expected_end - expected_start, received_end - received_start)
            for offset in range(substitutions):
                differences.append(
                    f"You said '{received[received_start + offset]}', but the target word "
                    f"is '{expected[expected_start + offset]}'."
                )
            missing = expected[expected_start + substitutions : expected_end]
            added = received[received_start + substitutions : received_end]
            differences.extend(f"You missed '{word}'." for word in missing)
            differences.extend(f"You added '{word}'." for word in added)
        elif operation == "delete":
            differences.extend(
                f"You missed '{word}'." for word in expected[expected_start:expected_end]
            )
        elif operation == "insert":
            differences.extend(
                f"You added '{word}'." for word in received[received_start:received_end]
            )

    return " ".join(differences)


class LessonMachine:
    """Two voice challenges checked against recognized words, not pronunciation."""

    def __init__(
        self,
        scenario: ScenarioSelection | None = None,
        ui_language: UiLanguage = "en",
    ) -> None:
        self.scenario = scenario or ScenarioSelection()
        self.ui_language = ui_language
        self.phase = LessonPhase.REPEAT
        self.failed_attempts = 0
        self.hint_offered = False
        self.has_skipped = False
        self._processed_event_ids: set[str] = set()
        self._processed_event_order: deque[str] = deque()

    def start_event(self) -> LessonStateEvent:
        return self._event(LessonOutcome.PROMPT)

    def answer(
        self,
        transcript: str,
        event_id: str | None = None,
    ) -> LessonStateEvent | None:
        if not self._remember_event(event_id):
            return None
        text = transcript.strip()
        if self.phase in {LessonPhase.COMPLETE, LessonPhase.SKIPPED}:
            return None
        if not sentence_words(text):
            return self._event(LessonOutcome.UNCLEAR)

        target = self.target_sentence
        if matches_target_sentence(target, text):
            if self.phase is LessonPhase.REPEAT:
                self.phase = LessonPhase.OBJECT
                self.failed_attempts = 0
                self.hint_offered = False
                return self._event(LessonOutcome.ACCEPTED)
            self.failed_attempts = 0
            if self.has_skipped:
                self.phase = LessonPhase.SKIPPED
                return self._event(LessonOutcome.ACCEPTED)
            self.phase = LessonPhase.COMPLETE
            return self._event(LessonOutcome.COMPLETED)
        self.failed_attempts = min(self.failed_attempts + 1, 99)
        event = self._event(LessonOutcome.RETRY)
        if self.failed_attempts >= 3:
            self.hint_offered = True
        return event

    @property
    def target_sentence(self) -> str:
        return scenario_targets(self.scenario)[1 if self.phase is LessonPhase.OBJECT else 0]

    def _event(self, outcome: LessonOutcome) -> LessonStateEvent:
        return LessonStateEvent(
            phase=self.phase,
            outcome=outcome,
            attempt=min(self.failed_attempts + 1, 99),
            failed_attempts=self.failed_attempts,
        )

    def _remember_event(self, event_id: str | None) -> bool:
        if event_id is None:
            return True
        if event_id in self._processed_event_ids:
            return False
        self._processed_event_ids.add(event_id)
        self._processed_event_order.append(event_id)
        if len(self._processed_event_order) > 256:
            self._processed_event_ids.remove(self._processed_event_order.popleft())
        return True

    def claim_event(self, event_id: str) -> bool:
        return self._remember_event(event_id)

    def move_on(self, event_id: str | None = None) -> LessonStateEvent | None:
        if not self.hint_offered:
            return None
        if not self._remember_event(event_id):
            return None
        if self.phase is LessonPhase.REPEAT:
            self.phase = LessonPhase.OBJECT
            self.failed_attempts = 0
            self.hint_offered = False
            self.has_skipped = True
            return self._event(LessonOutcome.SKIPPED)
        if self.phase is LessonPhase.OBJECT:
            self.phase = LessonPhase.SKIPPED
            self.failed_attempts = 0
            self.hint_offered = False
            self.has_skipped = True
            return self._event(LessonOutcome.SKIPPED)
        return None

    def response_intent(self, transcript: str) -> str | None:
        english = " ".join(sentence_words(transcript))
        help_requests = {
            "help",
            "please help",
            "i need help",
            "i do not know",
            "i dont know",
            "i do not understand",
            "i dont understand",
        }
        if english in help_requests:
            return "help"
        if self.ui_language == "hi":
            hindi = " ".join(transcript.casefold().strip().split())
            if hindi in {"मदद", "मुझे मदद चाहिए", "मुझे नहीं पता"}:
                return "help"
        if not self.hint_offered:
            return None
        if english in {"try again", "retry", "another try"}:
            return "retry"
        if english in {"move on", "skip this step", "next step"}:
            return "move_on"
        if self.ui_language == "hi":
            if hindi in {"फिर कोशिश करें", "दोबारा कोशिश करें"}:
                return "retry"
            if hindi in {"आगे बढ़ें", "अगला चरण"}:
                return "move_on"
        return None

    def response_instructions(
        self,
        event: LessonStateEvent,
        transcript: str = "",
    ) -> str:
        if event.outcome is LessonOutcome.UNCLEAR:
            if self.hint_offered:
                return self._hint_instructions(
                    "No clear transcript was received. Do not claim to have heard words. "
                    "Ask the learner to try the same target again or explicitly say “move on”."
                )
            return (
                "No clear transcript was received. Do not claim to have heard words or mark the "
                "target as correct. In one short English sentence, say you did not catch that and "
                "ask the learner to try again or speak a little more clearly."
            )
        if event.outcome is LessonOutcome.RETRY:
            target = self.target_sentence
            correction = (
                "Not quite. "
                + target_sentence_feedback(target, transcript)
                + " The correct sentence is: "
                + target
                + " Please try again."
            )
            instructions = (
                "The deterministic word check did not match the active target. Do not say the answer "
                "was correct. Say this brief feedback exactly, without adding or changing words: "
                + correction
                + " Do not judge pronunciation."
            )
            if event.failed_attempts == 3:
                return self._hint_instructions(instructions)
            if self.hint_offered:
                return instructions + " The learner may explicitly say “move on” to skip this step."
            return instructions
        if event.phase is LessonPhase.OBJECT and event.outcome is LessonOutcome.ACCEPTED:
            return (
                "Continue the selected everyday role-play. Respond naturally and briefly to the "
                "learner's successful sentence, then ask one relevant next question. Introduce this "
                f"exact target sentence: '{self.target_sentence}'. Ask the learner to say it once. "
                "Do not claim "
                "pronunciation was scored."
            )
        if event.phase is LessonPhase.SKIPPED and event.outcome is LessonOutcome.ACCEPTED:
            return (
                "The deterministic word check matched the current target. Acknowledge that briefly, "
                "but explain that an earlier step was skipped, so the full lesson is not complete. "
                "Do not claim full completion or pronunciation accuracy."
            )
        if event.outcome is LessonOutcome.COMPLETED:
            return (
                "The deterministic word check matched the target. Respond naturally in the selected "
                "scenario and briefly recap both useful sentences practised. Encourage the learner "
                "in simple English. Do not claim pronunciation was scored."
            )
        if event.outcome is LessonOutcome.SKIPPED:
            if self.phase is LessonPhase.SKIPPED:
                return (
                    "The learner chose to end this lesson without completing both steps. "
                    "Do not claim success or completion."
                )
            return (
                "The learner explicitly chose to move on. Do not imply the skipped target was "
                f"correct. Introduce the next target sentence: '{self.target_sentence}'."
            )
        return "Begin the selected role-play using its short scene instructions."

    def _hint_instructions(self, preceding: str) -> str:
        hint = (
            "Say this brief Hindi hint: 'विनम्रता से मदद माँगें और वाक्य के शब्द इसी क्रम में बोलें।'"
            if self.ui_language == "hi"
            else "Say this brief hint in simple English: 'Ask politely, and say the words in order.'"
        )
        return (
            preceding
            + " "
            + hint
            + f" The target sentence is '{self.target_sentence}'. Then explicitly say: "
            "'Say “try again” to retry, or “move on” to skip this sentence.' "
            "Moving on is not success."
        )
