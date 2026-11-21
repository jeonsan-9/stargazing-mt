// Each note contains only details relevant on an observing night.
const siteNotes = {
  bohyeon_obs: ["연구용 천문대입니다. 정상 진입로의 야간 차량 접근과 방문객센터 개방 여부를 출발 전에 확인하세요.", "한국천문연구원", "https://www.kasi.re.kr/boao/pageView/174"],
  bohyeon_sci: ["야간 관측은 회차별로 운영합니다. 예약한 회차에 구름이 많으면 관측이 설명으로 바뀔 수 있습니다.", "영천시", "https://www.yc.go.kr/starsm/contents.do?mId=1303000000"],
  uiseong: ["공원 데크에 달 조형물이 있습니다. 낮은 고도의 천체를 촬영할 때는 조형물과 파고라 위치를 살펴보세요.", "한국관광공사", "https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=4c8bf92a-0c72-4706-b6bb-7a6ccdc751e2"],
  gajisan: ["핀은 가지산 정상입니다. 석남터널 쪽에서 출발해도 정상까지 장비를 메고 걸어야 합니다.", "울산광역시", "https://www.ulsan.go.kr/tour/korean/contents.do?mId=001002003001000000"],
  yeongyang: ["별생태체험관과 반딧불이천문대는 운영시간이 다릅니다. 야간 관측은 천문대 회차를 확인하세요.", "생태관광", "https://www.ecotour.go.kr/front/board/area/detail/1197"],
  hwasan: ["핀은 화산산성 전망대입니다. 전망대의 풍차가 촬영 방향에 들어올 수 있습니다.", "한국관광공사", "https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=64c5f5f5-638a-41c6-8839-ec641961b93a"],
  juwang: ["지역 예보 기준점입니다. 야간 산행 전 탐방로별 입산 가능 시간을 확인하세요. 상의야영장은 별도 예약입니다.", "국립공원공단", "https://reservation.knps.or.kr/contents/C/serviceGuide.do?parkId=B07"],
  gamak: ["별바람언덕 능선에 풍력발전기가 있어 낮은 하늘을 가리는 방향이 있습니다.", "한국관광공사", "https://english.visitkorea.or.kr/svc/contents/contentsView.do?menuSn=351&vcontsId=35147"],
  dangpo: ["성곽 옆은 임진강 절벽입니다. 밤에는 관람로 안쪽에 삼각대를 놓으세요.", "연천군", "https://tour.yeoncheon.go.kr/tour/contents.do?key=3997"],
  anbandegi: ["핀은 주차장입니다. 주변은 경작 중인 고랭지 배추밭이므로 장비는 농로와 밭 밖에 놓으세요.", "한국관광공사", "https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=48c47eed-0ce0-47c3-a8b3-95233c761c75"],
  yukbaek: ["굽은 산길을 올라갑니다. 풍력발전기 날개가 낮은 하늘을 가릴 수 있어 촬영 구도를 먼저 확인하세요.", "평창군", "https://tour.pc.go.kr/Home/H20000/H20100/H20101/html"],
  byeolmaro: ["천문대 프로그램은 사전예약제입니다. 봉래산 진입 교통편과 셔틀 탑승 장소는 예약일 공지를 확인하세요.", "영월군시설관리공단", "https://www.ywfmc.or.kr/contents.do?cid=3a9c9f8e78ed450d81491ba347ff0b0d"],
  jwagusan: ["야간 관측은 사전예약제입니다. 25인승을 초과하는 버스는 천문대 주차장까지 올라갈 수 없습니다.", "증평군", "https://www.jp.go.kr/star/sub02_03_01.do"],
  kkotji: ["서쪽 바다로 시야가 열립니다. 밀물에 고립될 수 있는 갯바위 대신 해변 안쪽에서 관측하세요.", "태안군", "https://taean.go.kr/prog/tursmCn/tour/sub02_03/view.do?cntno=33"],
  bandi: ["박명 시각에 따라 야간 프로그램 시작 시간이 달라집니다. 흐린 날에는 관측권 구매 전 진행 여부를 확인하세요.", "무주군", "https://tour.muju.go.kr/star/contents.do?key=418"],
  namyeol: ["파도가 높고 뒤쪽에는 곰솔숲이 있습니다. 삼각대는 파도가 닿지 않는 곳에 놓고 숲이 가리는 방향을 확인하세요.", "한국관광공사", "https://access.visitkorea.or.kr/ms/detail.do?cotId=de873f51-9a01-46c3-98d7-9a9f35632e3a"],
  jeju1100: ["핀은 1100도로 휴게소입니다. 겨울에는 출발 전에 도로 결빙·차량 통제 공지를 확인하세요.", "제주도 도로 통제", "https://bangjae.jeju.go.kr/comm/noti.htm"],
  yecheon: ["야간 천체관측과 캠프는 예약제입니다. 주간 체험과 운영 시간이 다르니 야간 회차를 먼저 확인하세요.", "예천천문우주센터", "https://portsky.kr/main/index.html"],
  manhang: ["핀은 해발 약 1,330m 고갯마루 쉼터입니다. 겨울에는 도로 결빙과 차량 통제를 먼저 확인하세요.", "정선군", "https://www.jeongseon.go.kr/tour"],
  yanggu: ["야간 관측은 회차제로 운영합니다. 바로 옆 천문대 야영장은 매달 20일에 다음 달 예약을 받습니다.", "양구군 관광", "https://www.ygtour.kr/Home/index"],
  hwacheon: ["광덕산 해발 약 1,010m입니다. 월요일 휴관이고 강풍·안개 때는 출입이 제한될 수 있으며, 굽은 산길이라 밤 운전에 주의하세요.", "조경철천문대", "http://www.apollostar.kr/"],
  songam: ["정상 천문대는 케이블카로 오릅니다. 관측 프로그램과 케이블카 운행 일정을 예약 전에 확인하세요. 수도권 불빛이 남쪽 낮은 하늘을 밝힙니다.", "송암스페이스센터", "http://www.songamspacecenter.com/"],
  chungju: ["월요일 휴관입니다. 30인 이상 단체는 전화나 방문으로만 사전 예약합니다.", "충주고구려천문과학관", "https://www.gogostar.kr/"],
  cheongyang: ["월요일 휴관입니다. 야간 입장 인원이 제한돼 야간 관람권을 먼저 확보해야 할 수 있습니다.", "청양군", "https://www.cheongyang.go.kr/star.do"],
  miryang: ["야간 관측은 밀양시 통합예약으로 받습니다. 시내와 가까워 낮은 하늘은 밝은 편입니다.", "밀양시시설관리공단", "https://www.mycf.or.kr/astro/main/"],
  gimhae: ["분성산 정상이라 주차장이 따로 없습니다. 출발 전에 진입 방법을 확인하세요. 김해 시내 불빛이 강합니다.", "김해천문대", "https://astro.ghct.or.kr/"],
  gokseong: ["예약은 20인 이상 단체만 받고, 주말·공휴일에는 한 팀만 받습니다. 프로그램 일정과 휴관일은 홈페이지 게시판에 올라옵니다.", "곡성군", "https://www.gokseong.go.kr/star/"],
  suncheon: ["순천만습지 안에 있는 평지 천문대입니다. 야간 관측은 순천만습지 홈페이지에서 예약합니다.", "순천만습지", "https://scbay.suncheon.go.kr/intro_2024.jsp"],
  jangheung: ["월요일과 공휴일 다음 날 휴관입니다. 전화 예약은 30인 이상 단체만 받고, 7·8월 성수기에는 받지 않습니다.", "장흥군", "https://www.jangheung.go.kr/star"],
  goheung: ["저녁 휴게 시간이 있어 야간 회차 시작 시각을 확인하세요. 산 위라 해가 지면 기온이 빠르게 떨어집니다.", "고흥군", "http://star.goheung.go.kr/"],
  seogwipo: ["월별로 프로그램 시간이 달라 홈페이지에서 확인해야 합니다. 30인 이상 단체는 사전 예약이 필요합니다.", "서귀포시", "https://culture.seogwipo.go.kr/"],
};

export function renderSiteInfo(container, siteId) {
  container.replaceChildren();
  const note = siteNotes[siteId];
  if (!note) return;
  const link = document.createElement("a");
  link.href = note[2];
  link.textContent = note[1];
  const paragraph = document.createElement("p");
  paragraph.append(note[0], " ", link);
  container.append(paragraph);
}
