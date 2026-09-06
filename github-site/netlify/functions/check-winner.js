// ============================================================
// check-winner.js
//
// 학생승마웹앱의 "당첨확인" 화면이 실제로 호출하는 함수입니다.
// (기존에는 프론트엔드가 구글 앱스 스크립트 주소로 바로 fetch 했는데, 이제는 이 함수
//  주소로 fetch 하도록 프론트엔드의 WINNER_LOOKUP_URL만 바꿔주면 됩니다.)
//
// 동작 순서:
//   1) Netlify Blobs에 저장된 캐시(refresh-winners-cache.js가 5분마다 갱신)를 읽습니다.
//   2) 캐시가 있고 너무 오래되지 않았으면(STALE_MS 이내) 그 안에서 이름+생년월일로 매칭해서
//      바로 응답합니다 — 구글 시트를 열지 않으므로 매우 빠릅니다.
//   3) 캐시가 없거나(첫 배포 직후) 너무 오래됐으면(=스케줄 함수가 실패하고 있다는 뜻) 예전
//      방식대로 구글 앱스 스크립트에 직접 물어봅니다. 그러니 캐시에 문제가 생겨도 조회 기능
//      자체는 계속 동작합니다(그냥 예전만큼 느려질 뿐).
//
// 응답 형식은 기존 checkWinner_doGet.gs의 action=checkWinner 응답과 동일합니다:
//   { found: true, venue, school, status, winClass, ponyGrade } 또는 { found: false }
//
// 필요한 환경변수는 refresh-winners-cache.js와 동일합니다:
//   - WINNERS_APPS_SCRIPT_URL, WINNERS_CACHE_SECRET는 필요 없고,
//     예비 경로(fallback)에서만 WINNERS_APPS_SCRIPT_URL을 사용합니다(토큰 불필요, 기존 checkWinner 액션 그대로).
// ============================================================

const { getStore } = require('@netlify/blobs');

const APPS_SCRIPT_URL = process.env.WINNERS_APPS_SCRIPT_URL;
const STALE_MS = 20 * 60 * 1000; // 캐시가 20분 넘게 갱신 안 됐으면 예비 경로로 전환

function jsonResponse(obj) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(obj),
  };
}

// checkWinner_doGet.gs의 원래 매칭 로직과 동일하게 맞췄습니다:
// - 이름은 접두 일치(rowName이 name으로 시작하면 매칭 — "이찬솔(중2)"처럼 뒤에 붙는 경우 대비)
// - 생년월일은 전체 자리가 같거나, 뒤 6자리(MMDD+일부)가 같으면 매칭
function matchWinner(winners, name, birthDigits) {
  for (const w of winners) {
    if (!w || !w.name) continue;
    const nameMatches = w.name.indexOf(name) === 0;
    const birthMatches =
      !!birthDigits &&
      !!w.birthDigits &&
      (w.birthDigits === birthDigits || w.birthDigits.slice(-6) === birthDigits.slice(-6));
    if (nameMatches && birthMatches) return w;
  }
  return null;
}

// 캐시를 못 쓸 때만 호출하는 예비 경로 — 기존 방식(구글시트에 직접 물어보기) 그대로.
async function fetchDirectFromSheet(name, birth) {
  if (!APPS_SCRIPT_URL) {
    return { found: false, error: 'WINNERS_APPS_SCRIPT_URL not configured' };
  }
  const url = `${APPS_SCRIPT_URL}?action=checkWinner&school=&name=${encodeURIComponent(
    name
  )}&birth=${encodeURIComponent(birth)}`;
  const res = await fetch(url);
  return res.json();
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const name = (params.name || '').trim();
  const birth = (params.birth || '').trim();
  const birthDigits = birth.replace(/\D/g, '');

  if (!name || !birthDigits) {
    return jsonResponse({ found: false, error: 'name/birth required' });
  }

  try {
    const store = getStore('winners-cache');
    const cached = await store.get('data', { type: 'json' });

    const isFresh =
      !!cached &&
      !!cached.cachedAt &&
      Date.now() - new Date(cached.cachedAt).getTime() < STALE_MS &&
      Array.isArray(cached.winners);

    if (isFresh) {
      const winner = matchWinner(cached.winners, name, birthDigits);
      if (winner) {
        return jsonResponse({
          found: true,
          venue: winner.venue,
          school: winner.school,
          status: winner.status,
          winClass: winner.winClass,
           ponyGrade: winner.ponyGrade,      course: winner.course,
        });
      }
      return jsonResponse({ found: false });
    }

    // 캐시가 없거나 오래됐으면(자동 갱신이 실패하고 있다는 뜻) 예전 방식대로 직접 조회합니다.
    const fallback = await fetchDirectFromSheet(name, birth);
    return jsonResponse(fallback);
  } catch (err) {
    console.error('[check-winner] 캐시 조회 중 오류:', err);
    const fallback = await fetchDirectFromSheet(name, birth).catch(() => ({
      found: false,
      error: 'lookup failed',
    }));
    return jsonResponse(fallback);
  }
};
