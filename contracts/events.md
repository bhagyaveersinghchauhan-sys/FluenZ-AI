# LiveKit lesson event protocol

Messages are JSON data packets. Consumers must validate the topic, version, type, and every field; unknown messages are ignored and must not alter lesson state. Messages contain no transcript or audio.

## Agent to browser

- Topic: `fluenz.lesson.v1`
- Maximum payload: 512 bytes
- Schema:

```json
{
  "version": 1,
  "type": "lesson_state",
  "phase": "repeat_after_me | name_the_object | completed | skipped",
  "outcome": "prompt | retry | unclear | accepted | completed | skipped",
  "attempt": 1,
  "failed_attempts": 0
}
```

`attempt` is an integer from 1 through 99. `failed_attempts` is an integer from 0 through 99 and resets to zero when the learner advances to a new challenge. Only a nonempty answer that fails exact word matching increments it. After three failures, the agent offers a hint and an explicit retry or move-on choice. `retry` keeps the learner on the current challenge. `unclear` means speech was detected but no usable transcript was received; it is never evidence that words were understood and does not increment the failure count. `accepted` advances after an exact match. `skipped` records the learner's explicit choice to move on and is not success or completion. If a later target is answered correctly after a skip, the event remains in the `skipped` phase with `accepted` outcome: only that target matched, and the full lesson is incomplete. `completed` means the final answer matched the transcript target and no challenge was skipped, not that pronunciation was scored.

## Browser to agent

- Topic: `fluenz.lesson.command.v1`
- Maximum payload: 128 bytes
- The only supported command is:

```json
{
  "version": 1,
  "type": "lesson_command",
  "action": "replay"
}
```

The agent accepts commands only from the participant identity included in its validated dispatch metadata. It replays the current prompt without asking the LLM. Additional fields and unknown commands are rejected.

## Agent to browser: live learning coach

- Topic: `fluenz.coach.v1`
- Maximum payload: 4096 bytes
- Every event is JSON with `version: 1` and a session-wide increasing `sequence`.
- Vocabulary event:

```json
{
  "version": 1,
  "type": "vocabulary",
  "sequence": 1,
  "cards": [
    {
      "term": "studying",
      "definition": "Learning a subject by reading or practising.",
      "hindi_meaning": "पढ़ाई",
      "example": "I am studying English."
    }
  ]
}
```

`cards` contains one to three validated items selected from finalized learner turns. `hindi_meaning` and `example` are nullable strings. Terms must occur in the recognized speech; ordinary stop words, duplicates, malformed output, and Hindi cards without a Hindi meaning are discarded. No pronunciation or syllable claims are sent. The browser displays at most three cards, deduplicates by normalized term, and fades each card after about five seconds. It ignores events with stale sequence numbers.

- Fluency event:

```json
{
  "version": 1,
  "type": "fluency",
  "sequence": 2,
  "status": "thinking | hint | idle",
  "hesitation_count": 1,
  "hint": "What did you want to buy?"
}
```

`hint` is a nullable string and is present only for `status: "hint"`. The agent observes LiveKit `user_input_transcribed` and `user_state_changed` events. It waits for `FLUENCY_PAUSE_THRESHOLD_SECONDS` (default 1.5; allowed 0.5–5 seconds), cancels the check if the learner resumes, and asks the configured session LLM whether the current utterance is unfinished. Only an LLM-confirmed unfinished thought increments `hesitation_count`. A complete sentence, empty speech, tutor activity, or an unavailable/invalid LLM response does not count. The validated hint is spoken through the existing TTS session with interruptions enabled. These events contain no transcript, audio, or internal prompt. Unknown fields, invalid text, and stale sequence numbers must not change the UI.
