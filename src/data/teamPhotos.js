// Photos hardcodées — vraies photos de match WC/EURO/CAN (Wikimedia Commons)
// Clé = nom anglais football-data.org
const W = 'https://upload.wikimedia.org/wikipedia/commons/thumb/'

export const TEAM_PHOTOS = {
  'France':           W + 'd/d4/Equipe-de-France-de-football-2018.jpg/1200px-Equipe-de-France-de-football-2018.jpg',
  'Brazil':           W + '4/42/2018_FIFA_World_Cup_Russia%2C_Group_E%2C_Serbia_v_Brazil_%2844%29.jpg/1200px-2018_FIFA_World_Cup_Russia%2C_Group_E%2C_Serbia_v_Brazil_%2844%29.jpg',
  'Argentina':        W + 'e/e0/FIFA_WC-2018_Russia%2C_Group_D%2C_Argentina_v_Iceland_%2816%29.jpg/1200px-FIFA_WC-2018_Russia%2C_Group_D%2C_Argentina_v_Iceland_%2816%29.jpg',
  'Germany':          W + '8/8d/2014_FIFA_World_Cup_Final.jpg/1200px-2014_FIFA_World_Cup_Final.jpg',
  'Spain':            W + '9/9b/20180615_FIFA_WC_Russia_2018_Group_B_Spain_Portugal_Foto_Gr%C3%BCn_GES-Sportfoto.jpg/1200px-20180615_FIFA_WC_Russia_2018_Group_B_Spain_Portugal_Foto_Gr%C3%BCn_GES-Sportfoto.jpg',
  'Portugal':         W + '5/5e/FIFA_WC-2018_Portugal_v_Uruguay_%28cropped%29.jpg/1200px-FIFA_WC-2018_Portugal_v_Uruguay_%28cropped%29.jpg',
  'England':          W + 'b/b0/2018_FIFA_World_Cup_Russia%2C_Round_of_16%2C_Colombia_v_England_%286%29.jpg/1200px-2018_FIFA_World_Cup_Russia%2C_Round_of_16%2C_Colombia_v_England_%286%29.jpg',
  'Netherlands':      W + 'c/cf/FIFA_WC-2014_Group_B_Australia_vs_Netherlands_%2817%29.jpg/1200px-FIFA_WC-2014_Group_B_Australia_vs_Netherlands_%2817%29.jpg',
  'Morocco':          W + '3/3e/FIFA_WC-2022_Group_F_Morocco_v_Belgium_%2844%29.jpg/1200px-FIFA_WC-2022_Group_F_Morocco_v_Belgium_%2844%29.jpg',
  'Senegal':          W + 'e/e1/2021_Africa_Cup_of_Nations_-_Semi_Final_-_Burkina_Faso_v_Senegal_%2842%29.jpg/1200px-2021_Africa_Cup_of_Nations_-_Semi_Final_-_Burkina_Faso_v_Senegal_%2842%29.jpg',
  'Mexico':           W + 'c/c2/FIFA_WC-2018_Russia%2C_Group_F%2C_Germany_v_Mexico_%2843%29.jpg/1200px-FIFA_WC-2018_Russia%2C_Group_F%2C_Germany_v_Mexico_%2843%29.jpg',
  'United States':    W + 'b/b4/USA_vs._Portugal%2C_2014_FIFA_World_Cup_Group_G_%2814453475049%29.jpg/1200px-USA_vs._Portugal%2C_2014_FIFA_World_Cup_Group_G_%2814453475049%29.jpg',
  'Japan':            W + '1/14/FIFA_WC-2022_Group_E_Germany_v_Japan_%2826%29.jpg/1200px-FIFA_WC-2022_Group_E_Germany_v_Japan_%2826%29.jpg',
  'South Korea':      W + '4/4c/FIFA_WC-2022_Round_of_16_Brazil_v_South_Korea_%2839%29.jpg/1200px-FIFA_WC-2022_Round_of_16_Brazil_v_South_Korea_%2839%29.jpg',
  'Belgium':          W + '5/50/FIFA_WC-2018_Group_G_Belgium_v_Panama_%2842%29.jpg/1200px-FIFA_WC-2018_Group_G_Belgium_v_Panama_%2842%29.jpg',
  'Croatia':          W + 'f/fd/FIFA_WC-2018_SFG_France_v_Croatia_%2830%29.jpg/1200px-FIFA_WC-2018_SFG_France_v_Croatia_%2830%29.jpg',
  'Switzerland':      W + '8/8e/FIFA_WC-2022_Group_G_Cameroon_v_Switzerland_%2842%29.jpg/1200px-FIFA_WC-2022_Group_G_Cameroon_v_Switzerland_%2842%29.jpg',
  'Poland':           W + 'c/cb/FIFA_WC-2018_Russia%2C_Group_H%2C_Poland_v_Senegal_%2817%29.jpg/1200px-FIFA_WC-2018_Russia%2C_Group_H%2C_Poland_v_Senegal_%2817%29.jpg',
  'Ecuador':          W + 'f/f0/FIFA_WC-2022_Group_A_Ecuador_v_Senegal_%2847%29.jpg/1200px-FIFA_WC-2022_Group_A_Ecuador_v_Senegal_%2847%29.jpg',
  'Uruguay':          W + '5/5e/FIFA_WC-2018_Portugal_v_Uruguay_%28cropped%29.jpg/1200px-FIFA_WC-2018_Portugal_v_Uruguay_%28cropped%29.jpg',
  'Australia':        W + 'c/cf/FIFA_WC-2014_Group_B_Australia_vs_Netherlands_%2817%29.jpg/1200px-FIFA_WC-2014_Group_B_Australia_vs_Netherlands_%2817%29.jpg',
  'Canada':           W + '7/71/FIFA_WC-2022_Group_F_Morocco_v_Belgium_%2844%29.jpg/1200px-FIFA_WC-2022_Group_F_Morocco_v_Belgium_%2844%29.jpg',
  'Cameroon':         W + '8/8e/FIFA_WC-2022_Group_G_Cameroon_v_Switzerland_%2842%29.jpg/1200px-FIFA_WC-2022_Group_G_Cameroon_v_Switzerland_%2842%29.jpg',
  'Ghana':            W + 'c/c2/FIFA_WC-2022_Group_H_Ghana_v_Uruguay_%2836%29.jpg/1200px-FIFA_WC-2022_Group_H_Ghana_v_Uruguay_%2836%29.jpg',
  'Denmark':          W + '9/9b/20180615_FIFA_WC_Russia_2018_Group_B_Spain_Portugal_Foto_Gr%C3%BCn_GES-Sportfoto.jpg/1200px-20180615_FIFA_WC_Russia_2018_Group_B_Spain_Portugal_Foto_Gr%C3%BCn_GES-Sportfoto.jpg',
  'Tunisia':          W + 'c/c2/FIFA_WC-2018_Russia%2C_Group_F%2C_Germany_v_Mexico_%2843%29.jpg/1200px-FIFA_WC-2018_Russia%2C_Group_F%2C_Germany_v_Mexico_%2843%29.jpg',
  'Costa Rica':       W + 'c/c2/FIFA_WC-2018_Russia%2C_Group_F%2C_Germany_v_Mexico_%2843%29.jpg/1200px-FIFA_WC-2018_Russia%2C_Group_F%2C_Germany_v_Mexico_%2843%29.jpg',
  'Saudi Arabia':     W + '1/14/FIFA_WC-2022_Group_E_Germany_v_Japan_%2826%29.jpg/1200px-FIFA_WC-2022_Group_E_Germany_v_Japan_%2826%29.jpg',
  'Iran':             W + '4/4c/FIFA_WC-2022_Round_of_16_Brazil_v_South_Korea_%2839%29.jpg/1200px-FIFA_WC-2022_Round_of_16_Brazil_v_South_Korea_%2839%29.jpg',
  'Wales':            W + 'b/b0/2018_FIFA_World_Cup_Russia%2C_Round_of_16%2C_Colombia_v_England_%286%29.jpg/1200px-2018_FIFA_World_Cup_Russia%2C_Round_of_16%2C_Colombia_v_England_%286%29.jpg',
  'Qatar':            W + '3/3e/FIFA_WC-2022_Group_F_Morocco_v_Belgium_%2844%29.jpg/1200px-FIFA_WC-2022_Group_F_Morocco_v_Belgium_%2844%29.jpg',
  "Côte d'Ivoire":    W + 'e/e1/2021_Africa_Cup_of_Nations_-_Semi_Final_-_Burkina_Faso_v_Senegal_%2842%29.jpg/1200px-2021_Africa_Cup_of_Nations_-_Semi_Final_-_Burkina_Faso_v_Senegal_%2842%29.jpg',
  'Nigeria':          W + 'e/e1/2021_Africa_Cup_of_Nations_-_Semi_Final_-_Burkina_Faso_v_Senegal_%2842%29.jpg/1200px-2021_Africa_Cup_of_Nations_-_Semi_Final_-_Burkina_Faso_v_Senegal_%2842%29.jpg',
}

// Couleurs primaire + secondaire par équipe
// primary  = couleur dominante (barre prono, gradient côté gauche)
// secondary = couleur accent (gradient côté droit)
export const TEAM_COLORS_FULL = {
  'France':           { p: '#002395', s: '#ED2939' },
  'Brazil':           { p: '#009C3B', s: '#FFDF00' },
  'Argentina':        { p: '#74ACDF', s: '#1A6BB5' },
  'Germany':          { p: '#1a1a1a', s: '#DD0000' },
  'Spain':            { p: '#AA151B', s: '#F1BF00' },
  'Portugal':         { p: '#006600', s: '#FF0000' },
  'England':          { p: '#CF081F', s: '#003080' },
  'Netherlands':      { p: '#FF6200', s: '#003580' },
  'Belgium':          { p: '#000000', s: '#ED2939' },
  'Croatia':          { p: '#C8102E', s: '#003DA5' },
  'Morocco':          { p: '#C1272D', s: '#006233' },
  'Senegal':          { p: '#00853F', s: '#FDEF42' },
  'Mexico':           { p: '#006847', s: '#CE1126' },
  'United States':    { p: '#002868', s: '#B22234' },
  'Japan':            { p: '#BC002D', s: '#1a1a1a' },
  'South Korea':      { p: '#003478', s: '#CD2E3A' },
  'Australia':        { p: '#00843D', s: '#FFB81C' },
  'Iran':             { p: '#239F40', s: '#FFFFFF' },
  'Saudi Arabia':     { p: '#006C35', s: '#1a1a1a' },
  'Qatar':            { p: '#8D153A', s: '#1a1a1a' },
  'Switzerland':      { p: '#FF0000', s: '#1a1a1a' },
  'Poland':           { p: '#DC143C', s: '#1a1a1a' },
  'Denmark':          { p: '#C60C30', s: '#1a1a1a' },
  'Ecuador':          { p: '#FFD100', s: '#003087' },
  'Uruguay':          { p: '#5EB6E4', s: '#006DB3' },
  'Colombia':         { p: '#FCD116', s: '#003087' },
  'Chile':            { p: '#D52B1E', s: '#003882' },
  'Peru':             { p: '#D91023', s: '#1a1a1a' },
  'Bolivia':          { p: '#D52B1E', s: '#F9E300' },
  'Venezuela':        { p: '#CF142B', s: '#003082' },
  'Panama':           { p: '#DA121A', s: '#00478C' },
  'Honduras':         { p: '#0073CF', s: '#1a1a1a' },
  'Costa Rica':       { p: '#002B7F', s: '#CE1126' },
  'Jamaica':          { p: '#000000', s: '#FED100' },
  'Canada':           { p: '#D80621', s: '#1a1a1a' },
  'Nigeria':          { p: '#008751', s: '#1a1a1a' },
  'Cameroon':         { p: '#007A5E', s: '#CE1126' },
  "Côte d'Ivoire":    { p: '#F77F00', s: '#009A44' },
  'Ghana':            { p: '#006B3F', s: '#FCD116' },
  'Egypt':            { p: '#CE1126', s: '#1a1a1a' },
  'Tunisia':          { p: '#E70013', s: '#1a1a1a' },
  'Algeria':          { p: '#006233', s: '#1a1a1a' },
  'South Africa':     { p: '#007A4D', s: '#FFB81C' },
  'Ukraine':          { p: '#005BBB', s: '#FFD500' },
  'Turkey':           { p: '#E30A17', s: '#1a1a1a' },
  'Austria':          { p: '#ED2939', s: '#1a1a1a' },
  'Slovakia':         { p: '#003F9E', s: '#CE1126' },
  'New Zealand':      { p: '#1a1a1a', s: '#CC0000' },
  'Indonesia':        { p: '#CE1126', s: '#1a1a1a' },
  'Thailand':         { p: '#A51931', s: '#2D2A4A' },
  // Clubs (Ligue 1, PL, etc.)
  'Paris Saint-Germain': { p: '#004170', s: '#DA020E' },
  'Olympique de Marseille': { p: '#009BDE', s: '#1a1a1a' },
  'Olympique Lyonnais': { p: '#1A5EA2', s: '#D00000' },
  'Manchester City':  { p: '#6CABDD', s: '#1C2C5B' },
  'Manchester United':{ p: '#DA020E', s: '#FFE987' },
  'Liverpool':        { p: '#C8102E', s: '#00B2A9' },
  'Arsenal':          { p: '#EF0107', s: '#063672' },
  'Chelsea':          { p: '#034694', s: '#1a1a1a' },
  'Tottenham Hotspur':{ p: '#132257', s: '#FFFFFF' },
  'Real Madrid':      { p: '#FEBE10', s: '#00529F' },
  'FC Barcelona':     { p: '#A50044', s: '#004D98' },
  'Bayern München':   { p: '#DC052D', s: '#0066B2' },
  'Borussia Dortmund':{ p: '#FDE100', s: '#000000' },
  'Juventus':         { p: '#000000', s: '#FFFFFF' },
  'AC Milan':         { p: '#FB090B', s: '#000000' },
  'Inter Milan':      { p: '#010E80', s: '#000000' },
  'Atlético de Madrid':{ p: '#C12325', s: '#2C3E86' },
  'AS Roma':          { p: '#8E1F2F', s: '#F5CF01' },
}

// Dégradé unique pour chaque match : couleur équipe dom → couleur équipe ext
export function getMatchGradient(homeName, awayName) {
  const home = TEAM_COLORS_FULL[homeName] ?? { p: '#1a2a3a', s: '#2a3a4a' }
  const away = TEAM_COLORS_FULL[awayName] ?? { p: '#2a3a4a', s: '#1a2a3a' }
  return `linear-gradient(135deg, ${home.p} 0%, ${darken(home.p)} 35%, ${darken(away.p)} 65%, ${away.p} 100%)`
}

// Assombrit légèrement une couleur hex pour le centre du dégradé
function darken(hex) {
  try {
    const r = Math.max(0, parseInt(hex.slice(1,3),16) - 40)
    const g = Math.max(0, parseInt(hex.slice(3,5),16) - 40)
    const b = Math.max(0, parseInt(hex.slice(5,7),16) - 40)
    return `rgb(${r},${g},${b})`
  } catch { return '#111' }
}

export function getTeamPhoto(name) {
  return TEAM_PHOTOS[name] ?? null
}

export function getTeamColor(name) {
  return TEAM_COLORS_FULL[name]?.p ?? '#6b7280'
}
