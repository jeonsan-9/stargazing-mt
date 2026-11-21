// 계명대학교 학사일정과 지난 MT 기록
// 출처: 계명대 학사일정 (www.kmu.ac.kr 대학생활 > 학사안내 > 학사일정, 2026-11-21 확인)
// 중간고사는 공식 일정에 없어 8주차로 추정. 다른 해는 같은 규칙으로 추정합니다.

const KNOWN = {
  "2026-1": {
    start: "2026-03-03",
    end: "2026-06-22",
    avoid: [
      ["2026-04-20", "2026-04-25", "중간고사 (8주차 추정)"],
      ["2026-06-16", "2026-06-22", "기말고사"],
    ],
  },
  "2026-2": {
    start: "2026-09-01",
    end: "2026-12-18",
    avoid: [
      ["2026-09-24", "2026-09-27", "추석 연휴"],
      ["2026-10-19", "2026-10-24", "중간고사 (8주차 추정)"],
      ["2026-12-14", "2026-12-18", "기말고사"],
    ],
  },
};

function shift(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 개강일 기준 규칙으로 추정 (1학기 3월 2일 무렵, 2학기 9월 1일)
function guess(year, half) {
  const start = half === 1 ? `${year}-03-02` : `${year}-09-01`;
  // 개강 주 월요일
  const wd = new Date(`${start}T12:00:00Z`).getUTCDay();
  const mon = shift(start, wd === 0 ? 1 : wd === 6 ? 2 : 1 - wd);
  return {
    start,
    end: shift(mon, 15 * 7 + 5),
    avoid: [
      [shift(mon, 7 * 7), shift(mon, 7 * 7 + 5), "중간고사 (8주차 추정)"],
      [shift(mon, 15 * 7), shift(mon, 15 * 7 + 5), "기말고사 (16주차 추정)"],
    ],
    guessed: true,
  };
}

export function academic(year, half) {
  return KNOWN[`${year}-${half}`] ?? guess(year, half);
}

// 그 밤(ymd)과 다음날 중 피해야 할 일정이 있으면 이유를 돌려줌
export function conflict(ymd, sem) {
  const next = shift(ymd, 1);
  for (const [a, b, why] of sem.avoid) {
    if ((ymd >= a && ymd <= b) || (next >= a && next <= b)) return why;
  }
  return null;
}

// 동아리가 실제로 다녀온 MT (첫날 밤 기준)
export const PAST_MTS = [
  { ymd: "2025-11-08", sem: "2025년 2학기" },
  { ymd: "2026-05-23", sem: "2026년 1학기" },
  { ymd: "2026-11-14", sem: "2026년 2학기" },
];

export { shift };
