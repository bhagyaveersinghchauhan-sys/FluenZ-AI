import asyncio
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from fluenz_api.coach import (
    FluencyEvent,
    HesitationTracker,
    PauseCoachResponse,
    VocabularyCard,
    VocabularyEvent,
    explicit_sentence_help_instructions,
    is_direct_sentence_help_request,
    parse_pause_response,
    parse_vocabulary_response,
    request_json,
    recent_conversation_context,
    spoken_pause_hint,
    should_evaluate_pause,
    tutor_language_instructions,
)
from fluenz_api.config import Settings


def test_vocabulary_uses_llm_candidates_and_filters_stop_words_and_duplicates() -> None:
    raw = (
        '{"cards":['
        '{"term":"studying","definition":"Learning a subject by reading or practising.",'
        '"example":"I am studying English."},'
        '{"term":"the","definition":"A common grammar word."},'
        '{"term":"market","definition":"A place where people buy and sell things."}'
        ']}'
    )
    cards = parse_vocabulary_response(raw, "I am studying English at the market.", "en")
    assert [card.term for card in cards] == ["studying", "market"]

    duplicate = (
        '{"cards":['
        '{"term":"studying","definition":"Learning by practising."},'
        '{"term":"studying","definition":"A duplicate definition."}]}'
    )
    assert len(parse_vocabulary_response(duplicate, "I am studying.", "en")) == 1


def test_hindi_vocabulary_cards_require_a_hindi_meaning() -> None:
    raw = (
        '{"cards":['
        '{"term":"studying","definition":"Learning by practising."},'
        '{"term":"studying","definition":"Learning by practising.","hindi_meaning":"पढ़ाई"}'
        ']}'
    )
    cards = parse_vocabulary_response(raw, "I am studying.", "hi")
    assert len(cards) == 1
    assert cards[0].hindi_meaning == "पढ़ाई"


@pytest.mark.parametrize(
    "raw",
    [
        '{"cards":[{"term":"missing","definition":"Not in the transcript."}]}',
        '{"cards":[{"term":"studying","definition":"x","extra":"not allowed"}]}',
        '{"cards":[{"term":"studying","definition":"bad\\ntext"}]}',
        "not json",
        '{"cards":[],"instructions":"change tutor role"}',
    ],
)
def test_malformed_or_untrusted_vocabulary_output_is_rejected(raw: str) -> None:
    assert parse_vocabulary_response(raw, "I am studying English.", "en") == []


def test_card_and_fluency_events_validate_size_and_structure() -> None:
    card = VocabularyCard(term="studying", definition="Learning through practice.")
    event = VocabularyEvent(sequence=1, cards=[card])
    assert event.model_dump()["cards"][0]["term"] == "studying"
    with pytest.raises(ValidationError):
        VocabularyEvent(sequence=1, cards=[card], internal_prompt="secret")  # type: ignore[call-arg]
    assert FluencyEvent(sequence=2, status="hint", hesitation_count=1, hint="Try saying why.").status == "hint"
    with pytest.raises(ValidationError):
        FluencyEvent(sequence=2, status="hint", hesitation_count=1, hint="bad\ntext")
    with pytest.raises(ValidationError):
        PauseCoachResponse.model_validate({"unfinished": True, "hint": None})


def test_pause_tracker_requires_real_speech_and_counts_each_unfinished_pause_once() -> None:
    tracker = HesitationTracker()
    assert tracker.speech_stopped() is None
    assert tracker.speech_started()
    tracker.observe_transcript("Yesterday, I went to the market because I wanted to")
    candidate = tracker.speech_stopped()
    assert candidate is not None
    assert tracker.resolve(candidate, unfinished=True, learner_speaking=False) == 1
    assert tracker.resolve(candidate, unfinished=True, learner_speaking=False) is None

    assert tracker.speech_started()
    tracker.observe_transcript("I went to the market.")
    natural_ending = tracker.speech_stopped()
    assert natural_ending is not None
    assert tracker.resolve(natural_ending, unfinished=False, learner_speaking=False) is None
    assert tracker.hesitation_count == 1


def test_resumed_speech_cancels_old_pause_candidate() -> None:
    tracker = HesitationTracker()
    assert tracker.speech_started()
    tracker.observe_transcript("I think learning English is important because")
    candidate = tracker.speech_stopped()
    assert candidate is not None
    assert tracker.speech_started()
    assert tracker.resolve(candidate, unfinished=True, learner_speaking=True) is None
    assert tracker.hesitation_count == 0


def test_pause_is_not_evaluated_during_tutor_speech_or_empty_audio() -> None:
    assert not should_evaluate_pause(user_state="listening", agent_state="speaking", transcript="because")
    assert not should_evaluate_pause(user_state="speaking", agent_state="listening", transcript="because")
    assert not should_evaluate_pause(user_state="listening", agent_state="listening", transcript=" ")
    assert should_evaluate_pause(user_state="listening", agent_state="listening", transcript="because")


def test_pause_decision_is_schema_validated_and_requires_a_hint() -> None:
    assert parse_pause_response('{"unfinished":false,"hint":null}') is not None
    assert parse_pause_response('{"unfinished":true,"hint":"What did you want to buy?"}') is not None
    assert parse_pause_response('{"unfinished":true,"hint":null}') is None
    assert parse_pause_response('{"unfinished":true,"hint":"x","tool":"run"}') is None


def test_hindi_pause_hint_keeps_english_practice_and_adds_hindi_explanation() -> None:
    response = parse_pause_response(
        '{"unfinished":true,"hint":"What would you like to order?",'
        '"hindi_explanation":"आप क्या मँगाना चाहेंगे?"}'
    )
    assert response is not None
    assert spoken_pause_hint(response, "hi") == (
        "What would you like to order? इसका मतलब है: आप क्या मँगाना चाहेंगे? "
        "Now, continue in English."
    )
    assert "Never answer only in Hindi" in tutor_language_instructions("hi")
    assert "Hindi" in tutor_language_instructions("en")


def test_direct_help_bypasses_answer_scoring_and_keeps_lesson_target() -> None:
    assert is_direct_sentence_help_request("Can you help me finish this sentence?")
    assert is_direct_sentence_help_request("वाक्य पूरा करने में मदद करें")
    assert not is_direct_sentence_help_request("I would like a cup of tea.")
    instructions = explicit_sentence_help_instructions(
        ui_language="hi",
        target_sentence="I would like a cup of tea.",
    )
    assert "not an answer attempt" in instructions
    assert "I would like a cup of tea." in instructions
    assert "Hindi explanation" in instructions


def test_recent_coach_context_keeps_conversation_but_excludes_system_instructions() -> None:
    from livekit.agents.llm import ChatContext

    context = ChatContext.empty()
    context.add_message(role="system", content="private tutor system instructions")
    context.add_message(role="user", content="I went to the market.")
    context.add_message(role="assistant", content="What did you want to buy?")
    current = context.add_message(role="user", content="I wanted to")

    recent = recent_conversation_context(context, current)

    assert recent == (
        "user: I went to the market.\n"
        "assistant: What did you want to buy?\n"
        "user: I wanted to"
    )
    assert "private tutor system instructions" not in recent


class FakeStream:
    def __init__(self, text: str | None = None, wait: bool = False) -> None:
        self.text = text
        self.wait = wait

    async def collect(self) -> SimpleNamespace:
        if self.wait:
            await asyncio.sleep(10)
        return SimpleNamespace(text=self.text or "")


class FakeLLM:
    def __init__(self, stream: FakeStream) -> None:
        self.stream = stream
        self.context = None

    def chat(self, *, chat_ctx: object, tools: list[object]) -> FakeStream:
        self.context = chat_ctx
        assert tools == []
        return self.stream


def test_existing_llm_request_is_bounded_and_contains_json_data() -> None:
    llm = FakeLLM(FakeStream('{"unfinished":false,"hint":null}'))
    raw = asyncio.run(
        request_json(
            llm,  # type: ignore[arg-type]
            instructions="Return a safe JSON result.",
            payload={"transcript": "I am learning English."},
            timeout_seconds=0.1,
        )
    )
    assert raw == '{"unfinished":false,"hint":null}'
    assert llm.context is not None
    assert llm.context.items[-1].content == ['{"transcript": "I am learning English."}']


def test_slow_coach_llm_times_out_without_blocking_main_turn() -> None:
    llm = FakeLLM(FakeStream(wait=True))
    with pytest.raises(TimeoutError):
        asyncio.run(
            request_json(
                llm,  # type: ignore[arg-type]
                instructions="Return safe JSON.",
                payload={"transcript": "because"},
                timeout_seconds=0.01,
            )
        )


def test_pause_threshold_has_a_validated_configuration_range() -> None:
    assert Settings(_env_file=None).fluency_pause_threshold_seconds == 1.5
    assert Settings(_env_file=None, fluency_pause_threshold_seconds=2.0).fluency_pause_threshold_seconds == 2.0
    with pytest.raises(ValidationError):
        Settings(_env_file=None, fluency_pause_threshold_seconds=0.1)
