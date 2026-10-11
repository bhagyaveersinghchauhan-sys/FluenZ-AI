import { describe, expect, it } from 'vitest';
import { coachEventTopic, parseCoachEvent } from './coachEvents';

function packet(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe('coach event protocol', () => {
  it('accepts a safe vocabulary card and fluency hint', () => {
    expect(parseCoachEvent(
      packet('{"version":1,"type":"vocabulary","sequence":1,"cards":[{"term":"studying","definition":"Learning by practising.","hindi_meaning":"पढ़ाई","example":"I am studying English."}]}'),
      coachEventTopic,
    )).toMatchObject({
      type: 'vocabulary',
      cards: [{ term: 'studying', hindi_meaning: 'पढ़ाई' }],
    });
    expect(parseCoachEvent(
      packet('{"version":1,"type":"fluency","sequence":2,"status":"hint","hesitation_count":1,"hint":"What did you want to buy?"}'),
      coachEventTopic,
    )).toMatchObject({ status: 'hint', hesitation_count: 1 });
  });

  it('rejects malformed, oversized, unsafe, and unknown coach events', () => {
    expect(parseCoachEvent(packet('{"version":2,"type":"fluency"}'), coachEventTopic)).toBeNull();
    expect(parseCoachEvent(packet('{"version":1,"type":"fluency","sequence":1,"status":"hint","hesitation_count":1,"hint":"x","secret":"bad"}'), coachEventTopic)).toBeNull();
    expect(parseCoachEvent(packet('{"version":1,"type":"fluency","sequence":1,"status":"hint","hesitation_count":1,"hint":null}'), coachEventTopic)).toBeNull();
    expect(parseCoachEvent(packet('{"version":1,"type":"vocabulary","sequence":1,"cards":[{"term":"bad","definition":"line\\nbreak","hindi_meaning":null,"example":null}]}'), coachEventTopic)).toBeNull();
    expect(parseCoachEvent(new Uint8Array(4097), coachEventTopic)).toBeNull();
    expect(parseCoachEvent(packet('{"version":1,"type":"fluency","sequence":1,"status":"idle","hesitation_count":0,"hint":null}'), 'wrong.topic')).toBeNull();
  });
});
