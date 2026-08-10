// ============================================================
// refresh-winners-cache.js
//
// 5분마다(netlify.toml의 schedule 설정) 자동으로 실행되는 스케줄 함수입니다.
// 구글 시트(=구글 앱스 스크립트의 getAllWinners 액션)에서 전체 당첨자 명단을
// 한 번에 가져와서 Netlify Blobs(넷리파이 내장 저장소)에 캐시로 저장해둡니다.
//
// 실제 학생들의 조회 요청(check-winner.js)은 이 캐시를 읽기만 하므로, 매번
// 구글 시트를 직접 여는 것보다 훨씬 빠르고 안정적으로 응답할 수 있습니다.
//
// 필요한 환경변수 (Netlify 사이트 설정 > Environment variables에서 등록):
//   - WINNERS_APPS_SCRIPT_URL : checkWinner_doGet.gs가 배포된 주소
//   - WINNERS_CACHE_SECRET    : checkWinner_doGet.gs의 CACHE_REFRESH_SECRET과 동일한 값
// ============================================================

const { getStore } = require('@netlify/blobs');

const APPS_SCRIPT_URL = process.env.WINNERS_APPS_SCRIPT_URL;
const CACHE_SECRET = process.env.WINNERS_CACHE_SECRET;

exports.handler = async () => {
  if (!APPS_SCRIPT_URL || !CACHE_SECRET) {
    console.error(
      '[refresh-winners-cache] WINNERS_APPS_SCRIPT_URL / WINNERS_CACHE_SECRET 환경변수가 설정되지 않았습니다.'
    );
    return { statusCode: 500, body: 'missing env vars' };
  }

  try {
    const url = `${APPS_SCRIPT_URL}?action=getAllWinners&token=${encodeURIComponent(CACHE_SECRET)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data || !data.ok || !Array.isArray(data.winners)) {
      console.error('[refresh-winners-cache] 구글시트에서 명단을 불러오지 못했습니다.', data && data.error);
      return { statusCode: 502, body: 'failed to fetch winners from apps script' };
    }

    const store = getStore('winners-cache');
    await store.setJSON('data', {
      winners: data.winners,
      generatedAt: data.generatedAt,
      cachedAt: new Date().toISOString(),
    });

    console.log(`[refresh-winners-cache] 명단 캐시 갱신 완료: ${data.winners.length}명`);
    return { statusCode: 200, body: `ok (${data.winners.length} winners cached)` };
  } catch (err) {
    console.error('[refresh-winners-cache] 캐시 갱신 중 오류:', err);
    return { statusCode: 500, body: 'error' };
  }
};
