'use strict';

/* ============================================================
   BOLOPOLY — données du jeu
   Tout ce qui est modifiable (plateau, prix, cartes, personnages)
   est ici. Les montants sont en francs CFA.
   ============================================================ */

const K = 1000;

const CONFIG = {
  startingCash: 1500 * K,
  passStart: 200 * K,
  jailBail: 50 * K,
  tontineDues: 20 * K,       // cotisation versée à chaque passage par Départ
  buildStock: 36,            // niveaux de construction disponibles en banque
  mortgageRate: 0.5,
  unmortgageRate: 0.55,
  maxLevel: 5,
  minBid: 10 * K,
  rentBaseRate: 0.08,        // loyer du terrain nu = 8 % du prix
  rentMultipliers: [1, 5, 14, 36, 55, 75],
  jamMinLines: 2,            // lignes de transport pour éviter les embouteillages
  defaultMaxRounds: 30,
  seasonEvery: 4,
  saveKey: 'bolopoly-save-v5',
  bargainBonus: { commercante: 1 },
  bargainTable: [
    { min: 11, factor: 0.70, text: 'Tu arraches 30 %.' },
    { min: 9, factor: 0.90, text: 'Un petit geste : 10 % de remise.' },
    { min: 7, factor: 1.00, text: 'Le propriétaire ne bouge pas. Tarif plein.' },
    { min: 5, factor: 1.10, text: 'Il durcit le ton : +10 %.' },
    { min: 0, factor: 1.30, text: 'Mauvaise idée : il s’énerve et ajoute 30 %.' }
  ]
};

const TIERS = {
  urban: ['Terrain nu', 'Étal', 'Maquis', 'Restaurant', 'Immeuble', 'Grand complexe'],
  agri: ['Terre brute', 'Parcelle', 'Plantation', 'Séchoir', 'Coopérative', 'Usine de transformation']
};

const GROUPS = {
  populaire:  { label: 'Marchés populaires',     color: '#8f5a2e', kind: 'urban', buildCost: 50 * K },
  vivants:    { label: 'Quartiers vivants',      color: '#1fa0c4', kind: 'urban', buildCost: 50 * K },
  historique: { label: 'Abidjan historique',     color: '#d1428a', kind: 'urban', buildCost: 100 * K },
  littoral:   { label: 'Plages et lagune',       color: '#f08a1c', kind: 'urban', buildCost: 100 * K },
  cacao:      { label: 'Boucle du cacao',        color: '#b23a2a', kind: 'agri',  buildCost: 150 * K },
  nord:       { label: 'Nord : anacarde et coton', color: '#d9ad12', kind: 'agri', buildCost: 150 * K },
  carrefours: { label: 'Villes-carrefours',      color: '#12894f', kind: 'urban', buildCost: 200 * K },
  premium:    { label: 'Abidjan premium',        color: '#27479b', kind: 'urban', buildCost: 200 * K },
  transport:  { label: 'Transports',             color: '#3f4a56', kind: 'transport' },
  services:   { label: 'Services publics',       color: '#14899b', kind: 'service' }
};

/* Constructeurs de cases */
const P = (name, group, price, blurb) => ({ type: 'property', name, group, price: price * K, blurb });
const T = (name, icon, blurb) => ({ type: 'transport', name, group: 'transport', icon, price: 200 * K, blurb });
const U = (name, key, icon, blurb) => ({ type: 'utility', name, group: 'services', key, icon, price: 150 * K, blurb });

const SPACES = [
  { type: 'start', name: 'Départ', icon: '🏁' },                                                                 // 0
  P('Adjamé', 'populaire', 60, 'Le grand marché de la ville. Ça grouille jour et nuit.'),                      // 1
  { type: 'palabre', name: 'Palabre', icon: '💬' },                                                              // 2
  P('Abobo', 'populaire', 60, 'Grande commune populaire du nord d’Abidjan.'),                                  // 3
  { type: 'tax', name: 'Impôts DGI', amount: 100 * K, icon: '🧾' },                                           // 4
  T('Gbaka', '🚐', 'Le minibus que tout Abidjan connaît.'),                                                    // 5
  P('Yopougon', 'vivants', 100, 'Yop City, ses maquis et sa vie de quartier.'),                                // 6
  { type: 'coupe', name: 'Coupé-Décalé', icon: '🎉' },                                                         // 7
  P('Attécoubé', 'vivants', 100, 'Commune au bord de la lagune, à côté de la forêt du Banco.'),                // 8
  P('Koumassi', 'vivants', 120, 'Commune populaire et commerçante.'),                                          // 9
  { type: 'jail', name: 'Violon', icon: '🚔' },                                                                // 10
  P('Treichville', 'historique', 140, 'Quartier historique : port, marché et Palais de la Culture.'),          // 11
  U('SODECI', 'sodeci', '💧', 'La distribution de l’eau.'),                                                    // 12
  P('Port-Bouët', 'historique', 140, 'La commune de l’aéroport et des plages.'),                               // 13
  P('Marcory', 'historique', 160, 'Zone 4, ses restaurants et ses soirées.'),                                  // 14
  T('Woro-woro', '🚕', 'Le taxi collectif qui relie les communes.'),                                            // 15
  P('Grand-Bassam', 'littoral', 180, 'Ancienne capitale coloniale, classée à l’UNESCO.'),                      // 16
  { type: 'palabre', name: 'Palabre', icon: '💬' },                                                             // 17
  P('Jacqueville', 'littoral', 180, 'Ville lagunaire entre lagune et océan.'),                                 // 18
  P('Assinie', 'littoral', 200, 'Station balnéaire : le week-end sur le sable.'),                              // 19
  { type: 'tontine', name: 'Tontine', icon: '💰' },                                                            // 20
  P('Daloa', 'cacao', 220, 'La capitale de la boucle du cacao.'),                                              // 21
  { type: 'coupe', name: 'Coupé-Décalé', icon: '🎉' },                                                         // 22
  P('Soubré', 'cacao', 220, 'Son barrage et ses plantations de cacao.'),                                       // 23
  P('Gagnoa', 'cacao', 240, 'Cacao et café, en pays bété.'),                                                   // 24
  T('Bus SOTRA', '🚌', 'La Société des transports abidjanais.'),                                               // 25
  P('Korhogo', 'nord', 260, 'Capitale du Nord, célèbre pour ses tissus peints.'),                              // 26
  P('Bondoukou', 'nord', 260, 'Mosquées soudanaises et champs d’anacarde.'),                                   // 27
  U('CIE', 'cie', '⚡', 'La Compagnie ivoirienne d’électricité.'),                                             // 28
  P('Odienné', 'nord', 280, 'Le nord-ouest, région du Kabadougou.'),                                           // 29
  { type: 'goToJail', name: 'Descente de police', icon: '👮' },                                                // 30
  P('Bouaké', 'carrefours', 300, 'Deuxième ville du pays, grand carrefour.'),                                  // 31
  P('Yamoussoukro', 'carrefours', 300, 'Capitale politique et sa basilique Notre-Dame de la Paix.'),           // 32
  { type: 'palabre', name: 'Palabre', icon: '💬' },                                                            // 33
  P('San Pedro', 'carrefours', 320, 'Le grand port d’exportation du cacao.'),                                  // 34
  T('Bateau-bus', '⛴️', 'Les bateaux-bus qui traversent la lagune.'),                                          // 35
  { type: 'coupe', name: 'Coupé-Décalé', icon: '🎉' },                                                         // 36
  P('Cocody', 'premium', 350, 'Quartiers chics, Riviera et ambassades.'),                                      // 37
  { type: 'tax', name: 'Taxe foncière', amount: 100 * K, icon: '🏛️' },                                        // 38
  P('Plateau', 'premium', 400, 'Le quartier des affaires, des tours et des ministères.')                       // 39
];

/* Loyers et indices de groupes calculés une fois pour toutes */
const GROUP_INDEX = {};
SPACES.forEach((s, i) => {
  if (s.group) (GROUP_INDEX[s.group] = GROUP_INDEX[s.group] || []).push(i);
  if (s.type === 'property') {
    const base = Math.max(K, Math.round((s.price * CONFIG.rentBaseRate) / K) * K);
    s.rents = CONFIG.rentMultipliers.map((m) => base * m);
    s.buildCost = GROUPS[s.group].buildCost;
  }
});
const TRANSPORT_INDEXES = GROUP_INDEX.transport;

/* ---------- Personnages ---------- */
const CHARACTERS = [
  { id: 'commercante', name: 'La commerçante d’Adjamé', short: 'Commerçante', emoji: '🧺',
    power: 'Reine du marchandage : offre à −10 %, et +1 sur le jet si ça part aux dés.' },
  { id: 'planteur', name: 'Le planteur de cacao', short: 'Planteur', emoji: '🍫',
    power: 'Rentier de la terre : ses loyers sur les terres agricoles (cacao et Nord) sont majorés de 25 %.' },
  { id: 'chauffeur', name: 'Le chauffeur de gbaka', short: 'Chauffeur', emoji: '🚐',
    power: 'Roi du réseau : lignes de transport à −30 % et choix du trajet dès la première ligne.' },
  { id: 'etudiant', name: 'L’étudiant débrouillard', short: 'Étudiant', emoji: '🎓',
    power: 'Bourse d’études : +50 000 F de plus à chaque passage par Départ.' },
  { id: 'tech', name: 'L’entrepreneur tech', short: 'Entrepreneur', emoji: '📱',
    power: 'Cashback mobile money : 10 % remboursés sur chaque achat et chaque construction.' }
];

/* ---------- Cartes ----------
   fx.t : gain, pay, payTontine, payEach, collectEach, allReceive, repairs,
          jam, jailFree, goJail, back, moveTo, nearestTransport,
          collectPerOwned, utilityFee, collectTontine                    */
const DECKS = {
  palabre: {
    label: 'Palabre',
    cards: [
      { text: 'Funérailles dans la famille. Tu cotises 40 000 F.', fx: { t: 'pay', amount: 40 * K } },
      { text: 'Mariage d’un cousin : tu offres 15 000 F à chaque joueur.', fx: { t: 'payEach', amount: 15 * K } },
      { text: 'Baptême de ton neveu : chaque joueur t’offre 15 000 F.', fx: { t: 'collectEach', amount: 15 * K } },
      { text: 'Rentrée scolaire des petits frères. Tu paies 80 000 F.', fx: { t: 'pay', amount: 80 * K } },
      { text: 'Tabaski : le mouton coûte cher cette année. Tu paies 60 000 F.', fx: { t: 'pay', amount: 60 * K } },
      { text: 'Cotisation du quartier : 30 000 F vont dans la tontine.', fx: { t: 'payTontine', amount: 30 * K } },
      { text: 'Inondation à Yopougon : 15 000 F de réparations par niveau construit.', fx: { t: 'repairs', perLevel: 15 * K } },
      { text: 'Embouteillage sur le pont ! Les joueurs qui n’ont pas au moins 2 lignes de transport perdent leur prochain tour.', fx: { t: 'jam' } },
      { text: 'Un parent bien placé te sort d’affaire. Garde cette carte « Sortie du violon ».', fx: { t: 'jailFree' } },
      { text: 'Contrôle de police : direction le violon.', fx: { t: 'goJail' } },
      { text: 'Voyage au village : recule de 4 cases.', fx: { t: 'back', n: 4 } },
      { text: 'Un ami te rembourse une vieille dette : +60 000 F.', fx: { t: 'gain', amount: 60 * K } },
      { text: 'Tu as dépanné un voisin, il te remercie : +30 000 F.', fx: { t: 'gain', amount: 30 * K } },
      { text: 'Médicaments pour la grand-mère. Tu paies 50 000 F.', fx: { t: 'pay', amount: 50 * K } }
    ]
  },
  coupe: {
    label: 'Coupé-Décalé',
    cards: [
      { text: 'Les Éléphants soulèvent la coupe ! Chaque joueur reçoit 50 000 F de la banque.', fx: { t: 'allReceive', amount: 50 * K } },
      { text: 'Cashback Wave sur tes achats : +30 000 F.', fx: { t: 'gain', amount: 30 * K } },
      { text: 'Un transfert Orange Money arrive : +120 000 F.', fx: { t: 'gain', amount: 120 * K } },
      { text: 'Soirée coupé-décalé jusqu’au matin. Tu dépenses 70 000 F.', fx: { t: 'pay', amount: 70 * K } },
      { text: 'Récolte exceptionnelle : 30 000 F, plus 40 000 F par terrain agricole que tu possèdes.', fx: { t: 'collectPerOwned', base: 30 * K, per: 40 * K, kind: 'agri' } },
      { text: 'Week-end à Grand-Bassam : avance jusqu’à Grand-Bassam.', fx: { t: 'moveTo', to: 16 } },
      { text: 'Rendez-vous à Cocody : avance jusqu’à Cocody.', fx: { t: 'moveTo', to: 37 } },
      { text: 'Retour au Départ : avance jusqu’à la case Départ.', fx: { t: 'moveTo', to: 0 } },
      { text: 'Tu prends le premier transport : avance jusqu’à la ligne la plus proche. Si elle a un propriétaire, tu paies le double.', fx: { t: 'nearestTransport' } },
      { text: 'Délestage ! Tu paies 40 000 F au propriétaire de la CIE (ou à la banque).', fx: { t: 'utilityFee', key: 'cie', amount: 40 * K } },
      { text: 'Coupure d’eau : tu achètes de l’eau. 30 000 F au propriétaire de la SODECI (ou à la banque).', fx: { t: 'utilityFee', key: 'sodeci', amount: 30 * K } },
      { text: 'C’est ton tour de recevoir la tontine : tu empoches tout le pot.', fx: { t: 'collectTontine' } },
      { text: 'Subvention Startup Act pour ton projet : +80 000 F.', fx: { t: 'gain', amount: 80 * K } },
      { text: 'Redressement fiscal de la DGI. Tu paies 90 000 F.', fx: { t: 'pay', amount: 90 * K } },
      { text: 'Tout le monde danse : chaque joueur te donne 10 000 F.', fx: { t: 'collectEach', amount: 10 * K } },
      { text: 'Embouteillage au pont HKB ! Les joueurs qui n’ont pas au moins 2 lignes de transport perdent leur prochain tour.', fx: { t: 'jam' } },
      { text: 'Un oncle commissaire intervient. Garde cette carte « Sortie du violon ».', fx: { t: 'jailFree' } }
    ]
  }
};

const SEASONS = [
  { id: 'calm', name: 'Saison calme', blurb: 'Rien de particulier en ville.', icon: '🌤️' },
  { id: 'cacao', name: 'Prix du cacao en hausse', blurb: 'Loyers de la boucle du cacao +30 %.', icon: '🍫', groups: { cacao: 1.3 } },
  { id: 'nord', name: 'Mauvaise récolte dans le Nord', blurb: 'Loyers du Nord −30 %.', icon: '🌧️', groups: { nord: 0.7 } },
  { id: 'strike', name: 'Grève des gbakas', blurb: 'Les transports ne rapportent rien.', icon: '🚐', transport: 0 },
  { id: 'can', name: 'Coupe d’Afrique', blurb: 'Treichville, Cocody et Plateau : loyers +40 %.', icon: '🏆', tiles: { 11: 1.4, 37: 1.4, 39: 1.4 } }
];

const BOT_DIFF = {
  easy: {
    label: 'Facile', reserve: 400 * K, buyBias: 0.42, buildMax: 2, auctionOf: 0.55,
    acceptAt: 0.62, offer: 0.6, counter: false, useCard: false, payBail: false, delay: 420
  },
  normal: {
    label: 'Normal', reserve: 250 * K, buyBias: 0.82, buildMax: 4, auctionOf: 0.95,
    acceptAt: 0.84, offer: 0.8, counter: true, useCard: true, payBail: true, delay: 520
  },
  hard: {
    label: 'Difficile', reserve: 160 * K, buyBias: 1, buildMax: 5, auctionOf: 1.3,
    acceptAt: 0.92, offer: 0.8, counter: true, useCard: true, payBail: true, delay: 280, smart: true
  }
};

const SPACE_HELP = {
  start: 'Chaque passage par Départ rapporte 200 000 F.',
  jail: 'Simple visite si tu passes par là. Si tu es envoyé au violon : caution de 50 000 F, carte « Sortie du violon » ou un double aux dés (3 essais).',
  tontine: 'Le pot est alimenté par la cotisation de 20 000 F que chaque joueur verse à chaque passage par Départ, et par certaines cartes. Celui qui s’arrête ici ramasse tout.',
  goToJail: 'Descente de police : direction le violon, sans passer par Départ.',
  palabre: 'Pioche une carte Palabre : obligations de famille, imprévus, coups de main.',
  coupe: 'Pioche une carte Coupé-Décalé : bonnes surprises, fêtes et coups du sort.'
};
