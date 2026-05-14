const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const { generateFishingScrapNameBundle } = require('../lib/geminiFishingScrap');

const router = Router();

const RARITY_KO = {
  common:    '일반',
  rare:      '희귀',
  epic:      '에픽',
  legendary: '전설',
};

/** Singleplay-Game3 회수 아이템 UI 등급명 — AI 프롬프트용 */
const RARITY_SCRAP_YARD_KO = {
  common:    '일반(흔한 폐품)',
  rare:      '희귀(괜찮은 편)',
  epic:      '에픽(값나는 편)',
  legendary: '전설(극히 드문 물건)',
};

const VALID_TYPES = ['fish', 'creature', 'artifact', 'crystal', 'debris', 'cosmic', 'scrap'];

/** 일반·희귀 공유 캐시(shared_pixel_arts.name) — `shared`로 시작하는 키만 사용 */
const SHARED_SCRAPYARD_CACHE_PREFIX = 'shared:scrapyard:';

function sharedScrapyardCacheKey(displayName) {
  const d = String(displayName || '').trim();
  const maxLen = Math.max(1, 100 - SHARED_SCRAPYARD_CACHE_PREFIX.length);
  return `${SHARED_SCRAPYARD_CACHE_PREFIX}${d.slice(0, maxLen)}`;
}

const PIXELLAB_BASE_URL = 'https://api.pixellab.ai/v1';

const TYPE_STYLE = {
  fish:     'space fish, alien aquatic creature, fins and tail, marine life',
  creature: 'alien creature, space monster, living organism, organic body',
  artifact: 'mechanical device, space machine, sci-fi gadget, metallic object, gear or engine or tool',
  crystal:  'glowing crystal, gemstone, mineral shard, geometric facets',
  debris:   'space junk, wreckage, broken machine part, scrap metal, fragment',
  cosmic:   'cosmic entity, energy being, abstract space phenomenon',
  scrap:
    'salvaged space junk prop: either chunky industrial metal fragment OR recognizable everyday object ' +
    '(keyboard, shoe, plant pot, dumbbell), heavy readable silhouette, fills most of frame, ' +
    'no fish no ocean no creature face no human',
};

/** 한국어 이름 토큰 → PixelLab용 영어 형태 힌트 (긴 키워드 우선) */
/**
 * 한국어 이름 토큰 → PixelLab 영어 형태 힌트.
 * 긴(구체적) 키워드가 앞에 와야 짧은 키워드보다 먼저 매칭됨.
 * englishHintFromKoreanItemName() 은 name.includes(kw) 로 첫 번째 일치만 반환.
 */
const KOREAN_NAME_PIXEL_HINTS = [
  // ━━ 주방 — 복합어/가전 (긴 것 먼저) ━━━━━━━━━━━━━━━━━━━
  ['샌드위치프레스', 'hinged sandwich press with two flat grill plates and handle grip'],
  ['에어프라이', 'air fryer with rounded boxy body, drawer basket pull-out at bottom, round vent on top, not a cube'],
  ['전기밥솥', 'electric rice cooker with round white body and hinged dome lid, steam vent knob on top'],
  ['전기주전자', 'electric water kettle with spout, curved handle, and round power base'],
  ['전기포트', 'electric water kettle with spout, curved handle, and round power base'],
  ['커피머신', 'coffee machine with tall body, brew spout, removable carafe, and button panel'],
  ['커피포트', 'glass coffee carafe with curved handle and tapered pouring spout'],
  ['전자레인지', 'microwave oven with square boxy body, large glass front door, and side control panel'],
  ['식기세척기', 'dishwasher machine with rectangular front door and handle bar'],
  ['식기건조대', 'dish drying rack with vertical plate slots and utensil cups'],
  ['보온도시락', 'stacked insulated lunch box with locking clips and carry handle'],
  ['압력솥', 'pressure cooker with locking lid, rubber seal ring, and steam safety valve on top'],
  ['밀폐용기', 'rectangular airtight food container with four-clip snap lid'],
  ['냄비받침', 'round pot trivet stand, ring or star shaped heat-proof stand'],
  ['가마솥', 'large heavy iron cauldron with three short stub legs, wide open top'],
  ['보온병', 'insulated thermos bottle with screw-on cup cap, cylindrical slim body'],
  ['후라이팬', 'round frying pan with long side handle, flat circular pan bottom, not a cube'],
  ['프라이팬', 'round frying pan with long side handle, flat circular pan bottom, not a cube'],
  ['찜기', 'tiered steamer pot with perforated insert layer and domed lid'],
  ['블렌더', 'blender with tall clear jar on motor base, spinning blade at bottom'],
  ['믹서기', 'blender or hand mixer with jar body and motor base'],
  ['인덕션', 'flat smooth induction cooktop with glass surface and touch panel'],
  ['정수기', 'water purifier dispenser tower with cold-hot tap spouts'],
  ['토스터', 'pop-up toaster with two bread slots on top and lever on side'],
  ['냄비세트', 'set of stacked cooking pots with lids, two or three pots nested'],
  ['설거지통', 'rectangular plastic dish basin tub'],
  ['냉동고', 'chest freezer box with hinged lid'],
  ['와인셀러', 'wine cellar cabinet with angled bottle rack slots'],
  ['냉장고', 'tall upright refrigerator with two doors and handle bar'],
  ['도시락', 'rectangular lunch box with internal divider tray and clip latch lid'],
  ['칼갈이', 'knife sharpener block with sharpening slot or rod honing steel'],
  ['병따개', 'bottle opener with lever handle'],
  ['오프너', 'can opener with rotating cutting wheel and turning handle'],
  ['주전자', 'kettle with curved spout, round body, and arching handle on top'],
  ['티포트', 'ceramic teapot with round belly body, curved spout, and top loop handle'],
  ['텀블러', 'tall insulated travel mug tumbler with flip-top lid and handle'],
  ['물병', 'cylindrical water bottle with screw cap'],
  ['보온병', 'slim thermos bottle with screw cap, ribbed cylindrical body'],
  ['와인잔', 'wine glass with wide round bowl and long thin stem and flat base'],
  ['맥주잔', 'beer stein mug with large D-handle and cylindrical glass body'],
  ['샷글라스', 'small short shot glass, thick base, simple cylinder'],
  ['식칼', 'large kitchen chef knife with wide rectangular blade, visible handle'],
  ['가위', 'pair of scissors with two ring handles and angled blades'],
  ['과도', 'small paring knife with short narrow blade and simple handle'],
  ['젓가락', 'pair of long thin chopsticks laid side by side'],
  ['숟가락', 'spoon with oval bowl and long straight handle'],
  ['포크', 'fork with four tines and long handle'],
  ['수저', 'spoon and chopstick set side by side'],
  ['양념통', 'small round seasoning jar with lid and shaker holes on top'],
  ['접시', 'round flat dinner plate with slight raised rim'],
  ['국그릇', 'round soup bowl with wide rim, deeper than rice bowl'],
  ['밥그릇', 'round shallow rice bowl'],
  ['대접', 'large wide serving bowl'],
  ['도마', 'flat rectangular cutting board, wood or plastic'],
  ['밥솥', 'thick rice cooker pot with wide domed lid and center knob'],
  ['냄비', 'cooking pot with two side handles, cylindrical body with lid'],
  ['웍', 'round curved wok with one long handle, open wide top'],
  ['철솥', 'cast iron dutch oven with heavy domed lid'],
  // ━━ 욕실 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['욕실수납함', 'narrow bathroom storage cabinet with shelves behind door'],
  ['욕실장', 'tall bathroom mirror cabinet with two side panels'],
  ['욕실화', 'pair of rubber bathroom slippers with flat open-toe sole'],
  ['배수구망', 'small round drain strainer mesh basket'],
  ['배수구커버', 'round drain cover plate with holes'],
  ['세탁바구니', 'tall laundry hamper basket with fabric sides and handle'],
  ['빨래바구니', 'laundry basket with two handles, open top'],
  ['스팀다리미', 'steam iron with pointed front, steam vents on flat soleplate'],
  ['다림판', 'ironing board with narrow tapered padded surface and folding X-legs'],
  ['다리미', 'clothes iron with pointed nose, flat soleplate, and water fill cap'],
  ['건조대', 'folding clothes drying rack with multiple horizontal bars'],
  ['빨랫줄', 'clothesline with wooden pegs hanging on rope'],
  ['샤워커튼', 'shower curtain hanging on rings from a horizontal rod'],
  ['샤워줄', 'coiled shower hose flexible tube'],
  ['샤워볼', 'round mesh bath sponge puff ball on a cord'],
  ['스펀지', 'rectangular bath sponge, soft porous block'],
  ['슬리퍼', 'pair of open-toe flat slippers with foam sole'],
  ['발판', 'small two-step step stool'],
  ['휴지걸이', 'toilet paper holder bar with spring roller'],
  ['수건걸이', 'towel bar rack, horizontal bar on two wall mounts'],
  ['변기커버', 'oval padded toilet seat lid'],
  ['비데', 'bidet toilet seat with side control panel and spray nozzle'],
  ['변기', 'white ceramic toilet bowl with rear water tank'],
  ['욕조', 'bathtub, oval or rectangular basin on four short feet'],
  ['세탁망', 'zippered mesh laundry washing bag'],
  ['세면대', 'white ceramic sink basin with faucet taps'],
  ['디스펜서', 'pump soap dispenser with rounded bottle body and push pump top'],
  ['수건', 'folded bath towel, thick soft fabric rectangle'],
  ['샤워기', 'handheld shower head with round spray face and flexible hose'],
  ['바디워시', 'squeeze pump bottle of body wash, oval bottle shape'],
  ['린스', 'tall plastic conditioner bottle with flip-top cap'],
  ['샴푸', 'tall plastic shampoo bottle with flip-top cap'],
  ['치약', 'squeezable toothpaste tube with screw cap, tapered round end'],
  ['칫솔', 'toothbrush with long handle and small angled bristle head'],
  ['비누', 'oval bar of soap with rounded soft edges, foam bubbles on top, pastel color, not a cube'],
  // ━━ 전자·가전 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['기계식키보드', 'mechanical keyboard with tall individual keycaps and RGB underglow'],
  ['유선키보드', 'wired keyboard with flat keys and USB cable attached'],
  ['무선마우스', 'wireless computer mouse, smooth ergonomic body without cable'],
  ['게이밍마우스', 'gaming mouse with side buttons and textured grip, RGB lit'],
  ['보조배터리', 'rectangular portable power bank battery pack with USB-A ports on side'],
  ['파워뱅크', 'rectangular portable battery bank with USB ports'],
  ['셋톱박스', 'flat rectangular set-top cable box with LED status light on front'],
  ['블루레이플레이어', 'flat disc media player with disc slot on front face'],
  ['DVD플레이어', 'flat disc player with tray slot on front'],
  ['CD플레이어', 'portable CD player with round lid and earphone jack'],
  ['이어버드', 'two small wireless earbuds sitting in oval charging case with lid open'],
  ['사운드바', 'long slim horizontal soundbar speaker, wide flat bar shape'],
  ['스피커스탠드', 'tall slender speaker stand with small platform top'],
  ['외장하드', 'small external hard drive rectangular brick with single USB port'],
  ['보안경기', 'security camera with lens and housing mount'],
  ['공기청정기', 'air purifier tower with front air intake grille and top mist vent'],
  ['공유기', 'WiFi router with two or three antennas on top and port sockets on back'],
  ['멀티탭', 'power strip with four or more outlet sockets in a row with on/off buttons'],
  ['연장코드', 'extension cord reel or flat plug with trailing cable'],
  ['모션센서등', 'motion sensor light with dome infrared sensor bulge'],
  ['가습기', 'humidifier with round water tank, mist vent on top'],
  ['선풍기', 'electric fan with round blade guard and stand pole'],
  ['전기히터', 'electric space heater with coil front grill or flat panel'],
  ['전기담요', 'electric heated blanket, folded fabric with power controller on cord'],
  ['공기청정기', 'air purifier cylindrical tower with intake grille'],
  ['TV다이', 'TV stand media cabinet with shelves'],
  ['TV벽걸이', 'wall mount bracket arm for TV'],
  ['홈시어터', 'home theater surround sound set, subwoofer box and satellite speakers'],
  ['빔프로젝트', 'video projector box with round lens on front face'],
  ['PC모니터', 'flat LCD monitor screen with thin bezel and neck stand'],
  ['라디오시계', 'alarm clock radio with speaker grille and digital display'],
  ['라디오', 'portable radio with telescoping antenna and dial'],
  ['프린터', 'desktop inkjet printer with paper input tray and output slot'],
  ['스캐너', 'flatbed scanner with hinged glass-lid top'],
  ['복합기', 'all-in-one multifunction printer with document feeder on top'],
  ['팩스', 'fax machine with paper feed and phone handset'],
  ['리모컨', 'TV remote control, elongated rectangle with rows of small buttons'],
  ['어댑터', 'power adapter brick with prong plug and cable'],
  ['충전기', 'wall charger plug with USB port on face'],
  ['보조배터리', 'slim power bank rectangle with USB ports and LED indicator dots'],
  ['스마트폰', 'smartphone with large flat touchscreen, no keyboard, single camera lens'],
  ['태블릿', 'flat thin rectangular tablet with screen and short bezel'],
  ['노트북', 'open laptop computer, thin screen lid and full keyboard base'],
  ['스피커', 'speaker box with circular woofer cone and fabric grille'],
  ['사운드바', 'long flat horizontal soundbar speaker'],
  ['마이크', 'handheld dynamic microphone with bulbous capsule head on stick body'],
  ['웹캠', 'small webcam with round lens, clip-mount base'],
  ['프로젝터', 'projector box with circular lens on front, ventilation grilles on side'],
  ['모니터', 'flat widescreen computer monitor with thin stand neck and base'],
  ['헤드폰', 'over-ear headphones with large cushioned ear cups and padded headband'],
  ['이어폰', 'in-ear earphones, two small buds connected by thin wire cable'],
  ['키보드', 'flat rectangular keyboard with grid of keys'],
  ['마우스', 'computer mouse with two click buttons and scroll wheel'],
  ['게임패드', 'video game controller gamepad with dual analog sticks and shoulder buttons'],
  ['조이스틱', 'arcade joystick with ball top handle on square base'],
  ['CPU', 'square CPU processor chip with metal heat spreader lid and tiny pins grid'],
  ['GPU', 'wide graphics card PCB with dual fans heatsink shroud and PCIe bracket'],
  ['그래픽카드', 'wide graphics card with dual fans heatsink and PCIe connector edge'],
  ['RAM', 'long slim DDR memory RAM stick module with black PCB and chips'],
  ['메모리', 'long slim DDR memory RAM stick module with black PCB and chips'],
  ['파워서플라이', 'ATX PC power supply box with fan grille mesh and cable bundle'],
  ['SSD', 'flat rectangular M2 or SATA SSD storage drive with label sticker'],
  ['필통', 'pencil case zip pouch with pens and ruler silhouette'],
  ['필기구', 'pencil case with pens pencils eraser sticking out'],
  ['피아노', 'upright piano with keyboard white black keys and wooden cabinet'],
  ['건반', 'electronic keyboard piano with black and white keys and slim body'],
  ['청바지', 'folded blue denim jeans pants'],
  ['반바지', 'short casual shorts'],
  ['티셔츠', 'folded cotton crew neck t-shirt'],
  ['후드티', 'hooded sweatshirt with front pocket pouch'],
  ['셔츠', 'button dress shirt folded neatly'],
  // ━━ 공구 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['전동드릴', 'power drill with pistol grip handle, trigger, and chuck bit at front'],
  ['임팩드릴', 'impact driver with compact body, trigger, and hex socket bit'],
  ['레이저레벨', 'laser level tool with small boxy body and tripod mount'],
  ['수평기', 'spirit level bar, long flat rectangle with bubble tube vial'],
  ['공구함', 'toolbox with hinged lid, metal latch clasp, and handle on top'],
  ['공구세트', 'open tool set tray showing assorted tools arranged'],
  ['안전모', 'hard hat construction helmet, smooth dome with front brim'],
  ['방진마스크', 'dust respirator mask with two round filter cartridges'],
  ['귀마개', 'pair of earmuff hearing protectors on headband'],
  ['용접면', 'welding face shield with dark rectangular visor'],
  ['용접기', 'welding machine box with output cables and torch handle'],
  ['보안경', 'safety goggles with clear wide lens and elastic head strap'],
  ['체인톱', 'chainsaw with engine body, guide bar and chain, rear handle grip'],
  ['예초기', 'string trimmer weed whacker with motor head and long straight shaft'],
  ['잔디깍기', 'push lawn mower with roller wheels and engine body'],
  ['전지가위', 'pruning shears with curved blade and spring-loaded return'],
  ['전기톱', 'electric circular saw or electric chainsaw'],
  ['스프링클러', 'garden sprinkler head with rotating T-shaped arms'],
  ['물뿌리개', 'watering can with long arching spout and side carry handle'],
  ['드라이버', 'screwdriver with comfortable handle grip and flat or cross-head tip'],
  ['스패너', 'open-end wrench spanner, C-shaped jaw'],
  ['플라이어', 'slip-joint pliers with ribbed handles and hinge pivot'],
  ['펜치', 'needle-nose pliers or diagonal wire cutter pliers'],
  ['집게', 'kitchen or workshop tongs with two gripping arms and spring'],
  ['줄자', 'retractable tape measure with yellow coiled tape and metal casing'],
  ['렌치', 'adjustable crescent wrench with open jaw and worm-gear adjuster'],
  ['드릴', 'hand drill brace or power drill with bit chuck'],
  ['망치', 'claw hammer with flat striking face and curved claw at back, wooden handle'],
  ['톱', 'hand saw with serrated blade teeth and pistol grip handle'],
  ['삽', 'shovel with long straight handle and flat or pointed blade'],
  ['갈퀴', 'garden rake with long handle and fan of metal tines'],
  ['호미', 'Korean garden hoe, short handle with angled flat metal blade'],
  ['낫', 'sickle with curved crescent blade and short wooden handle'],
  ['가위', 'scissors with two finger-ring handles and crossing blades'],
  ['호스', 'green garden hose coiled in ring, nozzle at end'],
  ['철사', 'coil of thin metal wire'],
  ['철망', 'wire mesh grid panel or fencing screen'],
  ['와이어망', 'wire mesh grid or wire net panel'],
  ['체인', 'metal chain links, looped chain'],
  ['사다리', 'A-frame step ladder or straight extension ladder with rungs'],
  ['철사다리', 'metal step ladder with flat rungs and A-frame opening'],
  // ━━ 스포츠 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['배드민턴라켓', 'badminton racket with long handle and oval string head, very light frame'],
  ['테니스라켓', 'tennis racket with large oval strung head and long grip handle'],
  ['스케이트보드', 'skateboard deck with four polyurethane wheels, concave board shape'],
  ['롤러스케이트', 'roller skate boot with four wheels two-by-two and boot upper'],
  ['스쿼트랙', 'squat rack cage with two vertical posts, j-hooks, and safety arms'],
  ['벤치프레스', 'weight bench with flat padded seat and barbell rack at head end'],
  ['런닝머신', 'treadmill with flat running belt, two side handrails, and console display'],
  ['실내자전거', 'stationary exercise bike with padded seat, handlebars, and pedals'],
  ['스핀바이크', 'spinning bike with heavy round flywheel, minimalist frame'],
  ['로잉머신', 'rowing machine with sliding seat rail, foot stretchers, and handle cable'],
  ['풀업바', 'pull-up bar, single horizontal bar spanning between two vertical supports'],
  ['벤치', 'workout bench or park bench, long padded or wooden seat'],
  ['평행봉', 'parallel bars gymnastics apparatus, two horizontal bars side by side'],
  ['철링', 'pair of gymnastics rings hanging from straps'],
  ['요가블록', 'rectangular foam yoga block, soft rounded brick, not metal'],
  ['요가매트', 'rolled-up yoga exercise mat, cylindrical roll of thin foam'],
  ['폼롤러', 'cylindrical foam roller, solid round tube for muscle massage'],
  ['저항밴드', 'flat elastic resistance band loop, stretchy rubber ring'],
  ['헬스밴드', 'elastic fitness exercise band strip'],
  ['헬스벨트', 'wide leather weight lifting belt with buckle'],
  ['헬스장갑', 'fingerless padded weightlifting gloves'],
  ['구명조끼', 'bright orange life jacket vest with buckle straps'],
  ['스노클', 'J-shaped snorkel breathing tube with mouthpiece'],
  ['오리발', 'pair of rubber swim fins flippers, flat wide blade shape'],
  ['수모', 'swim cap, tight smooth dome cap'],
  ['수경', 'swimming goggles with two oval lenses and elastic strap'],
  ['무릎보호대', 'knee brace support wrap with velcro closure straps'],
  ['손목보호대', 'wrist support brace with rigid insert and velcro strap'],
  ['팔꿈치보호', 'elbow pad protective sleeve with hard cap'],
  ['발목보호', 'ankle brace with figure-eight strap'],
  ['어깨보호', 'shoulder pad protective guard'],
  ['허리보호', 'wide elastic back support belt'],
  ['스케이트', 'ice skate boot with metal blade attached to sole'],
  ['킥보드', 'kick scooter with flat deck, handlebar stem, and two wheels'],
  ['튜브', 'inflatable swim ring tube, round donut shape'],
  ['점핑로프', 'jump rope with two handles and looping rope arc between handles'],
  ['줄넘기', 'jump rope with two wooden handles and thin rope loop'],
  ['축구공', 'soccer football, round with black pentagon and white hexagon patches'],
  ['농구공', 'basketball, round orange ball with black seam lines'],
  ['배구공', 'volleyball, round ball with colored panel sections'],
  ['골프채', 'golf club, long thin shaft with angled iron or wood club head'],
  ['골프공', 'golf ball, small white sphere with dimple pattern'],
  ['야구배트', 'baseball bat, long cylindrical tapered bat with knob end'],
  ['야구공', 'baseball, white sphere with red double-stitch seam'],
  ['탁구채', 'table tennis paddle, small circular rubber face and short handle'],
  ['배구공', 'volleyball with colorful panel sections'],
  ['글러브', 'baseball mitt, padded leather glove with webbing pocket'],
  ['바벨', 'barbell, long horizontal bar with large round weight plates on each end'],
  ['원판', 'round weight disc plate with center hole'],
  ['아령', 'dumbbell pair with hexagonal rubber ends'],
  ['덤벨', 'dumbbell with two round weight plates and short grip bar'],
  ['케틀벨', 'kettlebell, round iron ball with thick looped handle on top'],
  // ━━ 가구 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['게이밍의자', 'gaming chair with high bucket seat back, armrests, and neck pillow'],
  ['사무의자', 'office chair with padded seat, armrests, and swivel base with wheels'],
  ['안락의자', 'cushioned armchair with wide padded seat and padded armrests'],
  ['리클라이너', 'recliner chair with extended footrest and reclined padded back'],
  ['높이조절의자', 'height-adjustable chair with gas lift lever'],
  ['접이식의자', 'folding chair, flat folded X-frame with seat and back panel'],
  ['드레스룸장', 'large walk-in wardrobe unit with hanging rods and shelves'],
  ['사이드테이블', 'small round or square side table with single pedestal leg'],
  ['코너선반', 'corner shelf bracket triangular wall shelf'],
  ['벽선반', 'floating wall shelf plank with hidden brackets'],
  ['책상램프', 'gooseneck desk lamp with adjustable arm and cone shade'],
  ['스탠드조명', 'floor standing lamp with tall pole and wide shade'],
  ['무드등', 'small soft glowing mood lamp or LED bulb'],
  ['스피커스탠드', 'tall slender speaker stand column'],
  ['TV다이', 'low TV entertainment stand cabinet with shelf'],
  ['드레서', 'vanity dresser with wide mirror on top and drawers below'],
  ['서랍장', 'chest of drawers, stacked horizontal drawers with pulls'],
  ['신발장', 'shoe rack cabinet with hinged drop-down shoe shelf doors'],
  ['장롱', 'tall traditional wide Korean wooden wardrobe with double doors'],
  ['드레스룸', 'walk-in closet room divider with hanging rails'],
  ['옷장', 'tall wardrobe closet with two doors and handles'],
  ['행거도어', 'sliding barn door hanging on upper rail track'],
  ['행거', 'clothes hanging rack with horizontal bar and bottom rail on wheels'],
  ['보석함', 'small decorative jewelry box with hinged lid and velvet interior'],
  ['보관함', 'storage box container with lid'],
  ['CD랙', 'slim CD storage rack with multiple disc slots'],
  ['DVD랙', 'slim DVD case storage shelf tower'],
  ['LP판', 'vinyl record disc, round black record with center label'],
  ['알람시계', 'round alarm clock with two bells on top and clock dial face'],
  ['탁상시계', 'small desktop alarm clock with rectangular or round face'],
  ['벽시계', 'round wall clock with hour markers and two clock hands'],
  ['액자', 'rectangular picture frame with wide decorative border'],
  ['거울', 'rectangular wall mirror with frame around the edge'],
  ['파티션', 'office partition divider panel standing upright on feet'],
  ['칸막이', 'folding divider screen panel'],
  ['책장', 'tall bookshelf unit with multiple horizontal shelves holding books'],
  ['책꽂이', 'small bookend holder or tabletop book rack'],
  ['책받침', 'tilted reading stand or book holder with page clips'],
  ['콘솔', 'narrow console table, long thin top and tapered legs'],
  ['티테이블', 'low round coffee table or tea table'],
  ['탁자', 'small side table or coffee table'],
  ['소파', 'upholstered three-seat sofa with armrests and soft cushions, not metal'],
  ['쿠션', 'decorative throw cushion pillow with patterned fabric cover'],
  ['방석', 'flat floor seat cushion pad, soft square'],
  ['침대', 'bed with headboard frame and thick mattress on top'],
  ['리클라이너', 'recliner chair with footrest out and reclined back'],
  ['스툴', 'bar stool, round padded seat on tall four-leg frame, no backrest'],
  ['파티션', 'freestanding room divider partition panel'],
  ['책상', 'rectangular writing desk with flat surface and four legs'],
  ['식탁', 'rectangular dining table with four legs'],
  ['의자', 'chair with four legs, flat seat, and straight backrest'],
  // ━━ 사무 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['화이트보드', 'whiteboard panel on wheeled stand with marker tray at bottom'],
  ['자석칠판', 'magnetic chalkboard panel with frame'],
  ['칠판지우개', 'chalkboard eraser, rectangular felt block'],
  ['칠판', 'rectangular blackboard chalkboard with chalk dust'],
  ['클립보드', 'clipboard with spring metal clip at top and flat hardboard base'],
  ['스테이플러', 'stapler with flat base and pivoting arm, staple opening at front'],
  ['홀펀치', 'hole punch, flat rectangular base with round punch mechanism'],
  ['펀치', 'single-hole punch tool'],
  ['제본기', 'book binding machine with comb punch and binding guide'],
  ['라벨기', 'label maker machine with tape cassette and print button'],
  ['바인더', 'three-ring binder with cover and D-ring mechanism'],
  ['파일철', 'ring binder or accordion file folder'],
  ['클립보드', 'clipboard with spring clip at top holding paper stack'],
  ['메모지', 'stack of small square sticky note pads, yellow notepad'],
  ['테이프', 'tape dispenser with clear tape roll on cutter'],
  ['서류가방', 'briefcase with handle, metal latch clasps, and rectangular body'],
  ['브리프케이스', 'leather briefcase with handle and locking clasps'],
  ['명함지갑', 'slim business card holder wallet'],
  ['명함철', 'business card binder with clear sleeve pages'],
  ['스케줄러', 'planner diary with ribbon bookmark and elastic band'],
  ['다이어리', 'hardcover diary notebook with bookmark ribbon'],
  ['캘린더', 'wall or desk calendar with page-flip pages'],
  ['독서대', 'tilted book reading stand with page holder clips'],
  ['화이트보드', 'white marker board panel on stand'],
  ['복사기', 'copy machine with paper tray and glass lid'],
  ['라벨지', 'sheet of peel-off address labels on backing paper'],
  ['사인펜', 'felt-tip marker pen with cap on end'],
  ['형광펜', 'bright highlighter marker with wide chisel tip'],
  ['마커', 'thick permanent marker pen with cap'],
  ['만년필', 'fountain pen with gold metal nib tip and slim barrel'],
  ['볼펜', 'ballpoint pen with clip and click button at top'],
  ['샤프', 'mechanical pencil with thin lead point and click advance button'],
  ['연필', 'hexagonal wooden pencil with pointed graphite tip and pink eraser top'],
  ['지우개', 'rectangular eraser block, white or pink rubber'],
  ['자', 'flat ruler strip with centimeter markings'],
  ['계산기', 'pocket calculator with keypad rows and digital display screen'],
  ['클립', 'binder clip or paper clip, small metal clip'],
  ['노트', 'spiral-bound notebook with ruled pages'],
  // ━━ 정원 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['바비큐집게', 'long BBQ grilling tongs with spring-hinge and handle loops'],
  ['훈연통', 'cylindrical BBQ smoker barrel with chimney vent stack and side firebox'],
  ['아이스박스', 'large ice cooler chest with handle and hinged lid'],
  ['파라솔', 'outdoor patio umbrella with tilted canopy and center pole and base'],
  ['가스버너', 'portable camping gas burner stove with round grate top'],
  ['분무기', 'trigger spray bottle with pump nozzle and clear tank'],
  ['화분받침대', 'plant pot stand with decorative curved legs'],
  ['화분받침', 'round saucer tray for under a flower pot'],
  ['화분', 'terracotta or ceramic flower pot with soil and small plant growing'],
  ['잔디씨', 'small seed packet bag with grass sprout illustration'],
  ['잔디모종', 'small tray of grass seedling sprouts'],
  ['잔디', 'patch of green grass turf, lawn ground cover'],
  ['비료', 'bag of fertilizer granules with plant growth icon'],
  ['퇴비', 'compost bin or bag with organic material inside'],
  ['흙', 'mound or pile of brown soil earth dirt'],
  ['모종삽', 'small garden hand trowel with pointed blade and D-grip handle'],
  ['호미', 'Korean hand garden hoe with angular flat blade and wooden handle'],
  ['낫', 'sickle with thin curved crescent blade and short grip handle'],
  ['갈퀴', 'garden rake with fan of metal tines and long handle'],
  ['삽', 'digging shovel with flat or pointed blade and long D-handle'],
  // ━━ 의류·생활 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['엑스박스 패드', 'Xbox game controller with two thumbsticks and trigger buttons'],
  ['플스 패드', 'PlayStation DualShock game controller with two thumbsticks'],
  ['닌텐도 패드', 'Nintendo game controller or Joy-Con pair'],
  ['방탄헬멧', 'military ballistic combat helmet, heavy dome with chin strap'],
  ['방탄복', 'bulletproof tactical vest with MOLLE front panel and velcro'],
  ['중갑옷', 'heavy full plate armor chest piece with shoulder pauldrons'],
  ['경량갑옷', 'light padded armor vest, leather or composite plate'],
  ['방수장화', 'tall rubber rain boots, waterproof knee-high boot pair'],
  ['고무장화', 'rubber rain boots, tall Wellington boot pair'],
  ['등산화', 'hiking boot with ankle collar and chunky rugged sole'],
  ['운동화', 'athletic sneaker with laces, rubber sole, and padded collar'],
  ['작업용장갑', 'heavy-duty work gloves with reinforced leather palm'],
  ['가죽장갑', 'smooth leather dress gloves, fitted five-finger pair'],
  ['가죽지갑', 'bifold leather wallet with card slots and bill compartment'],
  ['가죽벨트', 'leather belt with rectangular metal buckle, punched holes on strap'],
  ['금목걸이', 'gold necklace chain with decorative pendant or charm'],
  ['은반지', 'silver ring band, simple round circle with slight width'],
  ['동팔찌', 'copper bangle bracelet or linked copper chain bracelet'],
  ['은잔', 'silver goblet or silver cup with pedestal base'],
  ['유리컵', 'clear transparent drinking glass cup, cylindrical'],
  ['도자기그릇', 'ceramic pottery bowl with glazed finish'],
  ['스테인텀블러', 'stainless steel tumbler cup with rounded bottom and lid'],
  ['플라스틱통', 'plastic storage bucket or bin with handle'],
  ['이불세트', 'folded bedding set, puffy comforter with pillow'],
  ['베개', 'soft white bed pillow, rectangular stuffed pillow'],
  ['전기담요', 'electric heated blanket, soft folded fabric with control cord'],
  ['홈매트', 'thick foam exercise or floor mat, rolled or flat'],
  ['방석', 'round or square floor cushion pad'],
  ['쿠션', 'decorative throw cushion pillow'],
  ['수건', 'folded bath towel, thick rectangular fabric'],
  ['안전모', 'hard hat safety helmet, smooth dome with short brim'],
  ['철모', 'steel military helmet, round dome with neck flap'],
  ['헬멧', 'protective helmet, rounded dome with chin strap'],
  ['장화', 'tall rubber or leather boot, knee-height shaft'],
  ['장갑', 'pair of gloves, five-fingered hand covering'],
  ['지갑', 'folded wallet with card slots visible'],
  ['가방', 'bag with handle or straps, rectangular body'],
  ['벨트', 'belt strap with buckle, long flat strip'],
  ['모자', 'hat or cap with brim or dome'],
  // ━━ 조명·등기구 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['작업등', 'portable LED work floodlight on foldable stand, bright wide-angle lamp head, power cable'],
  ['정원등', 'outdoor garden stake light, spike base into ground, dome or lantern shade on top'],
  ['태양등', 'solar garden stake light, small solar panel on top, LED light body below'],
  ['센서등', 'motion sensor floodlight, PIR sensor dome, wide LED panel head, wall or ceiling mount'],
  ['벽등', 'wall sconce light fixture, wall-mounted with decorative arm and lamp shade'],
  // ━━ 가구 — 누락 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['거치대', 'adjustable device holder stand, clamp or base with articulated arm and mount cradle'],
  ['받침대', 'pedestal base stand, round or square platform for displaying an object'],
  ['조명', 'light fixture lamp, overhead pendant or floor lamp with diffused glow'],
  // ━━ 주방 — 누락 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['원두통', 'coffee bean canister with airtight lid and wooden scoop, cylindrical container'],
  ['정수필터', 'water filter cartridge, cylindrical filter element with O-ring seals'],
  ['식탁보', 'tablecloth draped over table edges, flat fabric sheet with decorative hem'],
  ['테이블보', 'table cover cloth, flat rectangular fabric draped over table'],
  ['키친타올', 'roll of kitchen paper towels on cardboard tube, perforated sheets'],
  ['행주', 'folded kitchen dish cloth, flat soft fabric rectangle for wiping'],
  ['양념병', 'small glass or plastic seasoning bottle with pour spout or flip cap'],
  ['식세기', 'dishwasher appliance with rectangular door and control panel'],
  // ━━ 욕실 — 누락 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['휴지통', 'small round wastebasket trash bin with or without lid'],
  // ━━ 전자 — 누락 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['메모리카드', 'small SD or microSD memory card, tiny rectangular chip card'],
  ['콘센트', 'electrical wall outlet socket with two or three plug holes'],
  ['랜허브', 'network hub or switch box with multiple ethernet port sockets on front'],
  ['시계', 'clock face with hour and minute hands, round dial'],
  ['패드', 'flat pad or controller, rectangular flat surface'],
  // ━━ 공구 — 누락 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['소켓세트', 'socket wrench set in open case tray, multiple hex socket pieces and ratchet handle'],
  ['비트세트', 'drill bit set in plastic case, multiple twist bits of different sizes arranged in row'],
  ['연장선', 'extension lead power cord, flat plug with multiple sockets and trailing cable'],
  ['압착기', 'crimping tool with long scissor handles and toothed jaw head'],
  ['못', 'metal nail, sharp pointed spike with flat head, single or small pile'],
  // ━━ 정원 — 누락 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['비닐하우스', 'greenhouse polytunnel, arched metal frame covered with clear plastic sheeting'],
  ['온실프레임', 'greenhouse frame structure, metal arched ribs or rectangular skeleton'],
  ['릴호스', 'garden hose reel, circular drum on wall bracket with hose wound around'],
  ['토치', 'hand torch or flame torch, cylinder body with nozzle tip and igniter'],
  ['숯', 'charcoal pieces, black porous lumps or charcoal bag'],
  ['모종이', 'seedling sprout tray with small green plants in individual soil cells'],
  ['배양토', 'bag of potting mix growing medium, sealed bag with soil texture'],
  ['상토', 'seedling starter soil mix bag, small bag with plant sprout on label'],
  ['살충제', 'insecticide spray can with pump nozzle, aerosol can'],
  ['제초제', 'weed killer bottle, trigger spray bottle with chemical liquid'],
  ['잡초제거기', 'weed puller tool, long handle with claw or fork tip at bottom'],
  ['거름', 'bag or pile of organic compost manure'],
  // ━━ 사무 — 누락 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['서류꽂이', 'document file organizer sorter with multiple vertical divider slots'],
  ['문서고', 'office document archive cabinet with multiple drawers and label holders'],
  ['과철기', 'heavy-duty paper hole punch or binding punch machine'],
  ['스티커', 'sheet of colorful peel-off stickers, or single sticker with decorative shape'],
  ['프린터용지', 'ream of printer paper in sealed wrapper'],
  ['라벨지', 'sheet of peel-off label stickers on backing paper'],
  ['스테이플', 'box of staples, small metal staple strips'],
  // ━━ 자연물 — 꽃 단독명 (꽃 접미사 없는 것) ━━━━━━━━━━━
  ['해바라기', 'sunflower with large yellow petals and dark brown seed center disc'],
  ['라벤더', 'lavender sprig with purple flower spike and grey-green narrow leaves'],
  ['로즈마리', 'rosemary herb sprig with thin needle-like leaves on woody stem'],
  ['수국', 'hydrangea cluster, ball of small blue or pink four-petal flowers'],
  ['진달래', 'azalea branch with pink or purple trumpet-shaped flower clusters'],
  ['개나리', 'forsythia branch with bright yellow four-petal flowers along bare stem'],
  ['라일락', 'lilac cluster, cone-shaped bundle of tiny purple or white flowers'],
  ['목련', 'magnolia flower, large white or pink cup-shaped bloom on bare branch'],
  ['동백', 'camellia flower, round full bloom with layered red or pink petals'],
  ['연꽃', 'lotus flower, pink petals around yellow center rising from water'],
  ['튤립', 'tulip flower, smooth cup-shaped bloom on single straight stem with leaf'],
  ['백합', 'lily flower, trumpet-shaped petals with stamens, on tall stem'],
  ['장미', 'rose flower, spiral layered petals, often red or pink, with thorny stem'],
  ['카네이션', 'carnation flower, ruffled layered petals, on thin stem'],
  ['국화', 'chrysanthemum flower, many narrow petals radiating from center'],
  ['민들레', 'dandelion, yellow flower head or white puffball seed head on stem'],
  ['클로버', 'four-leaf clover or clover patch, small round three-petal leaf clusters'],
  ['허브', 'herb plant, small leafy sprig with aromatic small leaves'],
  ['바질', 'basil herb, broad bright green aromatic leaves on branching stem'],
  // ━━ 자연물 — 나무 단독명 (나무 접미사 없는 것) ━━━━━━━━━
  ['유칼립투스', 'eucalyptus branch with oval silvery-blue leaves on arching stem'],
  ['편백', 'hinoki cypress tree, conical evergreen shape with dense scale-like foliage'],
  ['해송', 'Japanese black pine, gnarled trunk with dense dark green needle clusters'],
  ['흑송', 'black pine tree, twisted branches with long dark needle bundles'],
  // ━━ 자연물 — 풀·초본 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['억새', 'pampas grass, tall arching blades with fluffy silver plume seed head'],
  ['갈대', 'reed grass, tall straight stalks with brown cylindrical seed head on top'],
  ['쑥', 'mugwort herb, deeply lobed aromatic green leaves on stem'],
  ['호밀', 'rye grass stalk with long slender seed head spike'],
  ['보리', 'barley stalk with bristled seed head on top'],
  ['밀', 'wheat stalk with golden grain head drooping slightly'],
  // ━━ 자연물 — 가장 일반적이므로 맨 끝 ━━━━━━━━━━━━━━━━━━━
  ['꽃다발', 'flower bouquet wrapped in paper cone, multiple colorful blooms'],
  ['씨앗', 'small seed or cluster of seeds, tiny oval shapes'],
  ['구근', 'flower bulb root, oval teardrop bulb with papery skin'],
  ['다육', 'succulent plant with thick fleshy rosette leaves in pot'],
  ['선인장', 'cactus with green cylindrical body and spines, in small pot'],
  ['금전수', 'money tree plant with oval shiny leaves on multiple stems in pot'],
  ['몬스테라', 'monstera leaf, large split tropical leaf with holes'],
  ['야자', 'palm plant with arching feathery fronds'],
  ['고무나무', 'rubber tree plant with large oval glossy leaves'],
  ['나무', 'tree stump log or leafy deciduous tree silhouette'],
  ['꽃', 'single flower bloom with petals and green stem with leaves'],
  ['씨', 'tiny seed or seed pod shape'],
  ['잎', 'single leaf with veins, green and broad'],
  ['덩굴', 'climbing vine with curling tendrils and small leaves'],
  ['잔디', 'patch of short green grass turf'],
  ['풀', 'green grass blades or small plant sprigs'],
  ['열매', 'fruit or berry cluster on branch'],
  ['버섯', 'mushroom with round cap and short stem'],
  // ━━ 등(조명) 공통 fallback — 모든 xx등 미매칭 시 ━━━━━━━
  ['등', 'lamp or light fixture, glowing light source'],
];

function englishHintFromKoreanItemName(displayName) {
  const n = String(displayName || '');
  for (let i = 0; i < KOREAN_NAME_PIXEL_HINTS.length; i += 1) {
    const row = KOREAN_NAME_PIXEL_HINTS[i];
    const kw = row[0];
    const hint = row[1];
    if (kw && hint && n.includes(kw)) return hint;
  }
  return '';
}

/** Singleplay-Game3 회수 아이템 — 희귀도별 금속·야적 질감 (픽셀 아이콘용, 금속 감지 시) */
const SCRAP_RARITY_STYLE = {
  common:    'worn rust patina, dull gray brown steel, flat lighting, humble scrap metal or machine part',
  rare:      'cleaner machined steel, cool blue grey highlights, subtle edge gleam',
  epic:      'orange heat glow on edges, welding sparks, stronger metal contrast',
  legendary: 'dark steel with gold trim, ornate bolts, relic-like scrap centerpiece',
};

const RARITY_STYLE = {
  common:    'simple design, muted colors',
  rare:      'blue and purple tones, glowing aura',
  epic:      'red and gold fiery tones, intense glow',
  legendary: 'golden divine radiance, awe-inspiring, ornate details',
};

/** 힌트가 금속/공구류인지 판단 */
const METAL_HINT_KEYWORDS = ['metal', 'iron', 'steel', 'cast', 'alloy', 'gear', 'bolt', 'wrench', 'scrap', 'wire', 'blade', 'chain', 'anvil'];
function hintIsMetal(hint) {
  const h = (hint || '').toLowerCase();
  return METAL_HINT_KEYWORDS.some((k) => h.includes(k));
}

/** 아이템 이름 접두에 금속 재질 토큰이 있으면 금속 렌더링 적용 */
const METAL_NAME_PREFIXES = [
  '철', '강철', '고철', '산화철', '알루미늄', '스테인리스', '스테인',
  '청동', '황동', '백동', '니켈', '크롬', '코발트', '망간',
  '동', '구리', '아연', '주석', '납', '은', '금',
];
function namePrefixIsMetal(name) {
  return METAL_NAME_PREFIXES.some((p) => name.startsWith(p));
}

/** PixelLab은 영어 구도·재질 위주가 안정적 — 한국어 이름은 짧은 무드 힌트로만 */
function buildPixelLabPrompt(displayName, rarity, type, visualEn) {
  const clean = String(displayName || '').trim().slice(0, 48);
  const nameShapeHint = englishHintFromKoreanItemName(clean);
  const enHint = typeof visualEn === 'string' ? visualEn.trim().slice(0, 220) : '';

  // 금속 녹·야드 톤은 "금속"일 때만. 한글 힌트 없이 visualEn만 오면(낚시 Gemini) 영어 힌트로 판별
  let hasMetal;
  if (namePrefixIsMetal(clean)) {
    hasMetal = true;
  } else if (nameShapeHint) {
    hasMetal = hintIsMetal(nameShapeHint);
  } else if (type === 'scrap' && enHint) {
    hasMetal = hintIsMetal(enHint);
  } else {
    hasMetal = !nameShapeHint || hintIsMetal(nameShapeHint) || namePrefixIsMetal(clean);
  }

  let typeStyle = TYPE_STYLE[type] || TYPE_STYLE.scrap;
  if (type === 'scrap' && (nameShapeHint || enHint)) {
    typeStyle = hasMetal
      ? 'bent but recognizable real tool or machine part shape, not abstract geometry'
      : 'recognizable everyday object shape, plastic fabric wood or glass ok, not a plain metal cube';
  }

  // 금속 묘사(녹, 강철)는 금속성 힌트일 때만 적용
  const rarityMetal =
    type === 'scrap' && hasMetal
      ? (SCRAP_RARITY_STYLE[rarity] || SCRAP_RARITY_STYLE.common)
      : (RARITY_STYLE[rarity] || RARITY_STYLE.common);

  const parts = [
    nameShapeHint ? nameShapeHint : null,
    enHint ? enHint : null,
    'SNES era 16-bit pixel art inventory icon',
    'single object centered, large on canvas, thick chunky pixels',
    'high contrast silhouette, readable at tiny size',
    'game item loot sprite, crisp pixel edges, no anti-aliased smear',
    typeStyle,
    rarityMetal,
    'isolated subject, empty void around object, alpha friendly',
  ].filter(Boolean);
  const coreEn = parts.join(', ');

  if (clean) {
    return `${coreEn}, item name flavor (do not render as text): "${clean}"`;
  }
  return coreEn;
}

const PIXEL_NEGATIVE =
  'photograph, photo realistic, 3d render, octane, smooth shading, subsurface scatter, ' +
  'wide establishing shot, tiny subject, panorama, landscape, sky, stars, nebula, galaxy, ' +
  'underwater, ocean, fish, tentacles, anime character, human face, hands, body, ' +
  'text, caption, watermark, logo, signature, QR, HUD, UI frame, speech bubble, ' +
  'motion blur, depth of field bokeh, jpeg artifacts, empty blank canvas, collage, split screen';

function pixelNegativeForPrompt(imgPrompt) {
  const cookware =
    /frying pan|skillet|wok|kettle|cooking pot|cauldron|sandwich press|rice cooker|dutch oven/i.test(
      imgPrompt,
    );
  if (cookware) {
    return `${PIXEL_NEGATIVE}, shapeless cube, featureless box, minecraft block, ore block, isometric cube only, no handle`;
  }
  return PIXEL_NEGATIVE;
}

/* ── PixelLab 이미지 생성 헬퍼 ──────────────────────────── */
async function generatePixelLabImage(name, rarity, type, visualEn) {
  if (!process.env.PIXELLAB_SECRET) return null;

  const imgPrompt = buildPixelLabPrompt(name, rarity, type, visualEn);
  const negative = pixelNegativeForPrompt(imgPrompt);

  try {
    const plRes = await fetch(`${PIXELLAB_BASE_URL}/generate-image-pixflux`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.PIXELLAB_SECRET}`,
      },
      body: JSON.stringify({
        description: imgPrompt,
        image_size: { width: 64, height: 64 },
        negative_description: negative,
        text_guidance_scale: 7.25,
        no_background: true,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!plRes.ok) {
      const errText = await plRes.text().catch(() => '');
      console.error('[PixelLab] error:', plRes.status, errText);
      return null;
    }

    const plData = await plRes.json();
    console.log('[PixelLab] response keys:', Object.keys(plData || {}),
      'image keys:', Object.keys(plData?.image || {}));

    const b64 = plData?.image?.base64;
    if (!b64) {
      console.warn('[PixelLab] no base64 in response:', JSON.stringify(plData).slice(0, 300));
      return null;
    }

    const cost = plData?.usage?.usd;
    if (cost) console.log(`[PixelLab] "${name}" (${rarity}) — $${cost.toFixed(5)}`);

    // PixelLab은 raw base64만 반환하므로 data URL 접두사 추가
    return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  } catch (err) {
    console.error('[PixelLab] fetch error:', err.message || err);
    return null;
  }
}

/* ── POST /api/ai/catch ─────────────────────────────────────
   에픽·전설용: Claude + PixelLab (shared_pixel_arts 에는 절대 저장하지 않음 — 유저 catches 만)
   body: { rarity: 'epic' | 'legendary' }
   response: { name, type, emoji, imageUrl? }
──────────────────────────────────────────────────────────── */
router.post('/catch', requireAuth, async (req, res) => {
  const { rarity = 'epic' } = req.body;
  const rarityLabel = RARITY_SCRAP_YARD_KO[rarity] || RARITY_KO[rarity] || '에픽(값나는 편)';

  // ── 1. Claude로 이름/타입/이모지 생성 ──
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    return res.status(503).json({ error: 'AI module not available' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  const anthropic = new Anthropic();

  const namePrompt = `우주 잔해·폐품 수거 게임에서 등급 "${rarityLabel}"인 **아이템**(금속 파츠·설비 잔재·값나는 부품 등)을 방금 집었습니다.
(이름은 **산업·재활용·설비 잔해** 느낌을 살되, "그냥 쇳덩이" 한 마디로 끝나지 않게 구체적으로.)

아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요.

{
  "name": "이름 (한국어, 20자 이내, 야드·설비·금속 가공 용어를 섞어 독특하게)",
  "type": "scrap",
  "emoji": "이 물건·파츠를 표현하는 이모지 1개 (🔩⚙️🪨 등, 생물·물고기 이모지 금지)",
  "visualEn": "English only, max 22 words: concrete prop for pixel sprite (materials shapes only), no people no fish"
}

규칙:
- type은 반드시 문자열 "scrap" 만 (다른 값 금지).
- visualEn: PixelLab용 — 녹·용접·톱니·코일·I빔 등 **보이는 형태**만 영어로. 인물·문장·한국어 금지.
- 이름에 후라이팬·프라이팬·냄비·웍·주전자·밥솥 등 **조리 도구**가 들어가면, visualEn은 반드시 그 도구의 **실제 실루엣**(예: 후라이팬=원형 팬+긴 손잡이, 정육면체 금지)을 영어로 구체적으로 쓸 것.
- 에픽·전설: 무겁고 값나는 재료·설비 잔해·희귀 부품 느낌.
- 일반·희귀: 현실적인 야적·회수장에서 나올 법한 이름.
- 절대 반복되지 않도록 창의적으로`;

  let name, type, emoji, visualEn = '';
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 220,
      messages: [{ role: 'user', content: namePrompt }],
    });

    const text = (message.content[0]?.text || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    name  = typeof parsed.name  === 'string' ? parsed.name.slice(0, 30)  : null;
    type  = VALID_TYPES.includes(parsed.type) ? parsed.type : 'scrap';
    emoji = typeof parsed.emoji === 'string' ? parsed.emoji.slice(0, 8) : '🔩';
    visualEn =
      typeof parsed.visualEn === 'string' && parsed.visualEn.trim()
        ? parsed.visualEn.trim().slice(0, 220)
        : '';

    if (!name) return res.status(500).json({ error: 'AI returned empty name' });
  } catch (err) {
    console.error('[AI /catch] Claude error:', err.message || err);
    return res.status(500).json({ error: 'AI name generation failed' });
  }

  // ── 2. PixelLab 이미지 생성 (에픽·전설은 캐시 없이 항상 새로 생성) ──
  const imageUrl = await generatePixelLabImage(name, rarity, type, visualEn);

  res.json({ name, type, emoji, imageUrl });
});

/* ── POST /api/ai/image ──────────────────────────────────────
   일반(common)만: PixelLab 완료 후 shared_pixel_arts 저장 (name = `shared:scrapyard:` + 표시용 이름)
   희귀(rare) 티어는 게임에서 제거됨 — 이 API는 rarity=common 만 허용
   body: { name: string, type: string, rarity: 'common' }
   response: { imageUrl, cached, bonusCoins: 0, coins: null } — 스캔 보너스는 POST /api/ai/fishing-scan-bonus 에서만 지급
──────────────────────────────────────────────────────────── */

/** 20초당 100원: 경과 ms가 20초의 몇 배인지에 비례 (예: 20s→100, 40s→200). 최대 180초 반영. */
const SCAN_BONUS_MS_PER_100 = 20_000;

function computeFishingScanBonusFromElapsedMs(rawMs) {
  const ms = Math.min(180_000, Math.max(0, Math.floor(Number(rawMs) || 0)));
  return Math.min(999_999, Math.round((ms / SCAN_BONUS_MS_PER_100) * 100));
}

async function grantFishingScanBonusCoins(userId, amount) {
  const inc = Math.min(999_999, Math.max(0, Math.floor(Number(amount)) || 0));
  if (inc <= 0) return { bonusCoins: 0, coins: null };
  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { coins: { increment: inc } },
      select: { coins: true },
    });
    return { bonusCoins: inc, coins: updated.coins };
  } catch (err) {
    console.warn('[AI /fishing-scan-bonus] grant failed:', err.message);
    return { bonusCoins: 0, coins: null };
  }
}

/**
 * POST /api/ai/fishing-scan-bonus
 * Singleplay-Game3 심연 스캔 종료 후 1회 호출. body.scanElapsedMs 기준 **20초당 100원**(비례, 180초 상한).
 */
router.post('/fishing-scan-bonus', requireAuth, async (req, res) => {
  try {
    const raw = req.body && req.body.scanElapsedMs;
    const amount = computeFishingScanBonusFromElapsedMs(raw);
    const bonus = await grantFishingScanBonusCoins(req.user.id, amount);
    return res.json(bonus);
  } catch (err) {
    console.warn('[AI /fishing-scan-bonus]', err.message || err);
    return res.json({ bonusCoins: 0, coins: null });
  }
});

const GEMINI_FISHING_TIMEOUT_MS = 14_000;

/**
 * POST /api/ai/fishing-common
 * Singleplay-Game3 일반 스크랩: Gemini로 이름·이모지·visualEn 생성 후,
 * shared_pixel_arts(이름 키)에 이미지가 있으면 DB에서만 반환(PixelLab 생략), 없으면 생성·저장.
 * response: { name, type, emoji, imageUrl?, cached, nameSource?, bonusCoins: 0, coins: null } — 코인 보너스는 /fishing-scan-bonus
 */
router.post('/fishing-common', requireAuth, async (req, res) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GEMINI_FISHING_TIMEOUT_MS);
  try {
    const bundle = await generateFishingScrapNameBundle({ signal: ac.signal });
    if (!bundle || !bundle.name) {
      return res.status(503).json({ error: { message: '이름 생성 AI(Gemini)를 사용할 수 없습니다.' } });
    }
    const cleanName = String(bundle.name)
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 100);
    if (!cleanName) {
      return res.status(503).json({ error: { message: '이름 생성에 실패했습니다.' } });
    }
    const rarity = 'common';
    const type = 'scrap';
    const emoji = typeof bundle.emoji === 'string' && bundle.emoji.trim() ? bundle.emoji.trim().slice(0, 8) : '🔩';
    const cacheKey = sharedScrapyardCacheKey(cleanName);

    try {
      const cached = await prisma.sharedPixelArt.findUnique({
        where: { name: cacheKey },
        select: { imageData: true },
      });
      if (cached?.imageData) {
        console.log(`[AI /fishing-common] cache hit: "${cacheKey}"`);
        return res.json({
          name: cleanName,
          type,
          emoji,
          imageUrl: cached.imageData,
          cached: true,
          nameSource: 'gemini',
          bonusCoins: 0,
          coins: null,
        });
      }
    } catch (dbErr) {
      console.warn('[AI /fishing-common] cache lookup skipped:', dbErr.message);
    }

    const imageUrl = await generatePixelLabImage(cleanName, rarity, type, bundle.visualEn);
    if (!imageUrl) {
      console.warn(`[AI /fishing-common] PixelLab null for "${cleanName}"`);
      return res.json({
        name: cleanName,
        type,
        emoji,
        imageUrl: null,
        cached: false,
        pixelLabFailed: true,
        nameSource: 'gemini',
        bonusCoins: 0,
        coins: null,
      });
    }

    try {
      await prisma.sharedPixelArt.upsert({
        where: { name: cacheKey },
        create: { name: cacheKey, imageData: imageUrl, rarity, type },
        update: { imageData: imageUrl, rarity, type },
      });
      console.log(`[AI /fishing-common] saved: "${cacheKey}"`);
    } catch (dbErr) {
      console.warn('[AI /fishing-common] cache save skipped:', dbErr.message);
    }

    return res.json({
      name: cleanName,
      type,
      emoji,
      imageUrl,
      cached: false,
      nameSource: 'gemini',
      bonusCoins: 0,
      coins: null,
    });
  } catch (err) {
    console.error('[AI /fishing-common]', err.message || err);
    return res.status(500).json({ error: { message: '요청 처리 중 오류가 발생했습니다.' } });
  } finally {
    clearTimeout(timer);
  }
});

router.post('/image', requireAuth, async (req, res) => {
  const { name, type, rarity } = req.body;

  if (!name || typeof name !== 'string' || name.length > 100) {
    return res.status(400).json({ error: '잘못된 이름입니다.' });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `잘못된 타입: ${type}` });
  }
  if (rarity !== 'common') {
    return res.status(400).json({ error: '이 엔드포인트는 일반(common) 전용입니다.' });
  }

  const cleanName = name.trim();
  const cleanType = VALID_TYPES.includes(type) ? type : 'scrap';
  const cacheKey = sharedScrapyardCacheKey(cleanName);

  // ── 1. 공유 캐시 조회 (이름은 shared:scrapyard: 접두 + 표시용 이름)
  try {
    const cached = await prisma.sharedPixelArt.findUnique({
      where: { name: cacheKey },
      select: { imageData: true },
    });
    if (cached?.imageData) {
      console.log(`[SharedPixelArt] cache hit: "${cacheKey}" (display "${cleanName}")`);
      return res.json({ imageUrl: cached.imageData, cached: true, bonusCoins: 0, coins: null });
    }
  } catch (dbErr) {
    // 테이블 미생성 or prisma generate 미실행 — PixelLab으로 계속
    console.warn('[SharedPixelArt] cache lookup skipped:', dbErr.message);
  }

  // ── 2. PixelLab — 프롬프트에는 표시용 이름만 사용
  const imageUrl = await generatePixelLabImage(cleanName, rarity, cleanType);
  if (!imageUrl) {
    console.warn(`[AI /image] PixelLab returned null for "${cleanName}" (${rarity})`);
    return res.json({ imageUrl: null, cached: false, bonusCoins: 0, coins: null });
  }

  // ── 3. 공유 캐시 저장 (에픽+ 전용 엔드포인트는 여기를 거치지 않음)
  try {
    await prisma.sharedPixelArt.upsert({
      where:  { name: cacheKey },
      create: { name: cacheKey, imageData: imageUrl, rarity, type: cleanType },
      update: { imageData: imageUrl, rarity, type: cleanType },
    });
    console.log(`[SharedPixelArt] saved: "${cacheKey}" (${rarity})`);
  } catch (dbErr) {
    console.warn('[SharedPixelArt] save skipped (non-fatal):', dbErr.message);
  }

  // ── 4. 스캔 보너스는 POST /api/ai/fishing-scan-bonus 에서만 지급 ──
  res.json({ imageUrl, cached: false, bonusCoins: 0, coins: null });
});

/* ── GET /api/ai/floaters ────────────────────────────────────
   배경 플로터용: shared_pixel_arts 에서 랜덤 목록 반환
   쿼리: limit(1–40), includeScrapyard=1 이면 shared:scrapyard: 행도 포함(이름은 접두 제거)
   인증 불필요 (캐시 읽기 전용)
──────────────────────────────────────────────────────────── */
router.get('/floaters', async (req, res) => {
  const limit = Math.min(40, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
  const includeScrapyard =
    req.query.includeScrapyard === '1' || req.query.includeScrapyard === 'true';
  try {
    const arts = await prisma.sharedPixelArt.findMany({
      take: limit * 6,
      select: { name: true, imageData: true },
      orderBy: { createdAt: 'desc' },
    });
    const pool = arts.filter((a) => {
      const name = String(a.name || '');
      if (name.startsWith('shared:forge-equip:')) return false;
      if (!includeScrapyard && name.startsWith(SHARED_SCRAPYARD_CACHE_PREFIX)) return false;
      return true;
    });
    const stripPrefix = (name) => {
      const s = String(name || '');
      return s.startsWith(SHARED_SCRAPYARD_CACHE_PREFIX)
        ? s.slice(SHARED_SCRAPYARD_CACHE_PREFIX.length)
        : s;
    };
    const mapped = pool.map((a) => ({
      name: stripPrefix(a.name),
      imageData: a.imageData,
    }));
    for (let i = mapped.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [mapped[i], mapped[j]] = [mapped[j], mapped[i]];
    }
    res.json({ arts: mapped.slice(0, limit) });
  } catch (err) {
    console.warn('[AI /floaters]', err.message);
    res.json({ arts: [] });
  }
});

module.exports = router;
