// missions.js — the Crescent Keys story chain. All people, places and events are original.
// Stage types understood by the main loop:
//   goto      — reach the marker
//   timedgoto — reach the marker before the timer runs out
//   collect   — visit every point (optional timer)
//   rob       — stay inside the zone for holdTime seconds; sets wanted on completion
//   shake     — lose your wanted level completely
//   race      — pass checkpoints in order before the timer runs out
//   pickupvan — reach and enter the mission cargo van
//   deliver   — bring the mission van to the marker with at least minHealth health

export const MISSIONS = [
  {
    title: 'First Wheels',
    giver: 'Marisol Vega',
    giverPos: { x: 2180, y: 2970 },
    pay: 200,
    intro: [
      'You made it to San Aurelio, cousin. The island runs on favours, and favours run on wheels.',
      'A crate of mine is sitting at the South Docks. Fetch it, then drop it at Marv\u2019s Motors across town. Do that, and Crescent Keys starts opening for you.',
    ],
    outro: 'Clean work. Marv owes me now — and I owe you. Keep the phone on.',
    stages: [
      { type: 'goto', x: 1060, y: 3300, label: 'Pick up Marisol\u2019s crate at the South Docks' },
      { type: 'goto', x: 3640, y: 1660, label: 'Drop the crate at Marv\u2019s Motors' },
    ],
  },
  {
    title: 'Hot Delivery',
    giver: 'Marv Delgado',
    giverPos: { x: 3640, y: 1660 },
    pay: 300,
    intro: [
      'So you\u2019re Marisol\u2019s new driver. Good. A surfer kid at the boardwalk needs these parts before the tide turns — that\u2019s seventy-five seconds of daylight, friend.',
      'Don\u2019t baby the car. Cars I can fix. Reputations, not so much.',
    ],
    outro: 'Ha! Still warm. You drive like the island owes you money. I like it.',
    stages: [
      { type: 'timedgoto', x: 1560, y: 3380, time: 75, label: 'Deliver the parts to the boardwalk — fast!' },
    ],
  },
  {
    title: 'Dockside Dash',
    giver: 'Old Pete',
    giverPos: { x: 980, y: 3360 },
    pay: 350,
    intro: [
      'Storm blew my catch money clean off the dock last night. Three cash boxes, scattered along the south shore.',
      'Grab \u2019em before the gulls unionise, and there\u2019s a cut in it for you.',
    ],
    outro: 'Every last note. You\u2019ve got dock-eyes, kid. Pete won\u2019t forget it.',
    stages: [
      {
        type: 'collect', time: 100, label: 'Recover Old Pete\u2019s cash boxes (0/3)',
        points: [
          { x: 700, y: 3260 }, { x: 1400, y: 3400 }, { x: 2100, y: 3330 },
        ],
      },
    ],
  },
  {
    title: 'Boardwalk Takings',
    giver: 'Marisol Vega',
    giverPos: { x: 2180, y: 2970 },
    pay: 450,
    intro: [
      'The boardwalk kiosk has been skimming from every stall on the crescent. Tonight the till comes home.',
      'Stand at the kiosk, empty it, and then — this is the important part — disappear. The Aurelio Police Department frowns on arithmetic like ours.',
    ],
    outro: 'Gone like sea mist. The stalls eat this week because of you.',
    stages: [
      { type: 'rob', x: 1560, y: 3470, holdTime: 4, wanted: 3, label: 'Empty the boardwalk kiosk till' },
      { type: 'shake', label: 'Lose the police — break line of sight and stay hidden' },
    ],
  },
  {
    title: 'Crescent Circuit',
    giver: 'Lex Tran',
    giverPos: { x: 4600, y: 830 },
    pay: 400,
    intro: [
      'Name\u2019s Lex. I run the Circuit — six lights, one loop, no trophies, just money and bragging rights.',
      'Hit every checkpoint before the clock dies and the pot is yours. Bend a fender and I\u2019ll pretend not to notice. This once.',
    ],
    outro: 'That\u2019s a Circuit time worth framing. The island\u2019s talking about you now.',
    stages: [
      {
        type: 'race', time: 110, label: 'Crescent Circuit — hit the checkpoints!',
        points: [
          { x: 4600, y: 1400 }, { x: 3320, y: 1400 }, { x: 3320, y: 2680 },
          { x: 4600, y: 2680 }, { x: 4600, y: 3320 }, { x: 2040, y: 3320 },
        ],
      },
    ],
  },
  {
    title: 'Heavy Cargo',
    giver: 'Marv Delgado',
    giverPos: { x: 3640, y: 1660 },
    pay: 600,
    intro: [
      'A cargo van at the docks is carrying something nobody insured and everybody wants.',
      'Drive it here to my lot. Bring it home breathing — at least a third of its health — and expect the APD to take an interest the moment you roll.',
    ],
    outro: 'Not a scratch worth mentioning. Whatever\u2019s in that van, it\u2019s Marv\u2019s problem now.',
    stages: [
      { type: 'pickupvan', x: 1060, y: 3240, label: 'Pick up the cargo van at the South Docks' },
      { type: 'deliver', x: 3640, y: 1660, minHealth: 0.35, wanted: 2, label: 'Deliver the van to Marv\u2019s Motors (keep it intact)' },
    ],
  },
  {
    title: 'Keys to the City',
    giver: 'Marisol Vega',
    giverPos: { x: 2180, y: 2970 },
    pay: 1200,
    intro: [
      'Last job, cousin. Three people run this island\u2019s shadows: Ana Sol in the north-west, Bruno Rey on the east docks road, and Captain Ilya by the south market.',
      'Visit each of them, take their blessing — then shake the four-star welcome party the APD throws you, and Crescent Keys is yours.',
    ],
    outro: 'That\u2019s everyone. Docks, boardwalk, circuit, shadows — the whole crescent knows your name now.',
    stages: [
      { type: 'goto', x: 760, y: 830, label: 'Meet Ana Sol at the north-west plaza' },
      { type: 'goto', x: 4600, y: 1470, label: 'Meet Bruno Rey on the east docks road' },
      { type: 'goto', x: 1400, y: 3250, label: 'Meet Captain Ilya by the south market' },
      { type: 'rob', x: 2680, y: 2040, holdTime: 3, wanted: 4, label: 'Take the mayor\u2019s strongbox from City Hall plaza' },
      { type: 'shake', label: 'Lose the police — become a ghost' },
    ],
  },
];

export function stageTarget(stage) {
  if (!stage) return null;
  if (stage.type === 'collect' || stage.type === 'race') return null; // handled specially
  if (typeof stage.x === 'number') return { x: stage.x, y: stage.y };
  return null;
}
