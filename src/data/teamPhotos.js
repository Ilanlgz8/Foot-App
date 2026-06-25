// Photos d'ambiance par équipe nationale — Wikimedia Commons (no CORS)
// Clé = nom anglais football-data.org. Fallback = gradient CSS si absent.
const W = 'https://upload.wikimedia.org/wikipedia/commons/thumb/'

export const TEAM_PHOTOS = {
  'France':       W + 'd/d4/Equipe-de-France-de-football-2018.jpg/1200px-Equipe-de-France-de-football-2018.jpg',
  'Brazil':       W + '4/42/2018_FIFA_World_Cup_Russia%2C_Group_E%2C_Serbia_v_Brazil_%2844%29.jpg/1200px-2018_FIFA_World_Cup_Russia%2C_Group_E%2C_Serbia_v_Brazil_%2844%29.jpg',
  'Argentina':    W + 'e/e0/FIFA_WC-2018_Russia%2C_Group_D%2C_Argentina_v_Iceland_%2816%29.jpg/1200px-FIFA_WC-2018_Russia%2C_Group_D%2C_Argentina_v_Iceland_%2816%29.jpg',
  'Germany':      W + '8/8d/2014_FIFA_World_Cup_Final.jpg/1200px-2014_FIFA_World_Cup_Final.jpg',
  'Spain':        W + '9/9b/20180615_FIFA_WC_Russia_2018_Group_B_Spain_Portugal_Foto_Gr%C3%BCn_GES-Sportfoto.jpg/1200px-20180615_FIFA_WC_Russia_2018_Group_B_Spain_Portugal_Foto_Gr%C3%BCn_GES-Sportfoto.jpg',
  'Portugal':     W + '5/5e/FIFA_WC-2018_Portugal_v_Uruguay_%28cropped%29.jpg/1200px-FIFA_WC-2018_Portugal_v_Uruguay_%28cropped%29.jpg',
  'Uruguay':      W + '5/5e/FIFA_WC-2018_Portugal_v_Uruguay_%28cropped%29.jpg/1200px-FIFA_WC-2018_Portugal_v_Uruguay_%28cropped%29.jpg',
  'England':      W + 'b/b0/2018_FIFA_World_Cup_Russia%2C_Round_of_16%2C_Colombia_v_England_%286%29.jpg/1200px-2018_FIFA_World_Cup_Russia%2C_Round_of_16%2C_Colombia_v_England_%286%29.jpg',
  'Netherlands':  W + 'c/cf/FIFA_WC-2014_Group_B_Australia_vs_Netherlands_%2817%29.jpg/1200px-FIFA_WC-2014_Group_B_Australia_vs_Netherlands_%2817%29.jpg',
  'Morocco':      W + '3/3e/FIFA_WC-2022_Group_F_Morocco_v_Belgium_%2844%29.jpg/1200px-FIFA_WC-2022_Group_F_Morocco_v_Belgium_%2844%29.jpg',
  'Senegal':      W + 'e/e1/2021_Africa_Cup_of_Nations_-_Semi_Final_-_Burkina_Faso_v_Senegal_%2842%29.jpg/1200px-2021_Africa_Cup_of_Nations_-_Semi_Final_-_Burkina_Faso_v_Senegal_%2842%29.jpg',
  'Mexico':       W + 'c/c2/FIFA_WC-2018_Russia%2C_Group_F%2C_Germany_v_Mexico_%2843%29.jpg/1200px-FIFA_WC-2018_Russia%2C_Group_F%2C_Germany_v_Mexico_%2843%29.jpg',
  'United States':W + 'b/b4/USA_vs._Portugal%2C_2014_FIFA_World_Cup_Group_G_%2814453475049%29.jpg/1200px-USA_vs._Portugal%2C_2014_FIFA_World_Cup_Group_G_%2814453475049%29.jpg',
  'Japan':        W + '1/14/FIFA_WC-2022_Group_E_Germany_v_Japan_%2826%29.jpg/1200px-FIFA_WC-2022_Group_E_Germany_v_Japan_%2826%29.jpg',
  'South Korea':  W + '4/4c/FIFA_WC-2022_Round_of_16_Brazil_v_South_Korea_%2839%29.jpg/1200px-FIFA_WC-2022_Round_of_16_Brazil_v_South_Korea_%2839%29.jpg',
  'Australia':    W + 'c/cf/FIFA_WC-2014_Group_B_Australia_vs_Netherlands_%2817%29.jpg/1200px-FIFA_WC-2014_Group_B_Australia_vs_Netherlands_%2817%29.jpg',
  'Belgium':      W + '5/50/FIFA_WC-2018_Group_G_Belgium_v_Panama_%2842%29.jpg/1200px-FIFA_WC-2018_Group_G_Belgium_v_Panama_%2842%29.jpg',
  'Croatia':      W + 'f/fd/FIFA_WC-2018_SFG_France_v_Croatia_%2830%29.jpg/1200px-FIFA_WC-2018_SFG_France_v_Croatia_%2830%29.jpg',
  'Switzerland':  W + '8/8e/FIFA_WC-2022_Group_G_Cameroon_v_Switzerland_%2842%29.jpg/1200px-FIFA_WC-2022_Group_G_Cameroon_v_Switzerland_%2842%29.jpg',
  'Poland':       W + 'c/cb/FIFA_WC-2018_Russia%2C_Group_H%2C_Poland_v_Senegal_%2817%29.jpg/1200px-FIFA_WC-2018_Russia%2C_Group_H%2C_Poland_v_Senegal_%2817%29.jpg',
  'Canada':       W + '7/71/FIFA_WC-2022_Group_F_Morocco_v_Belgium_%2844%29.jpg/1200px-FIFA_WC-2022_Group_F_Morocco_v_Belgium_%2844%29.jpg',
  'Ecuador':      W + 'f/f0/FIFA_WC-2022_Group_A_Ecuador_v_Senegal_%2847%29.jpg/1200px-FIFA_WC-2022_Group_A_Ecuador_v_Senegal_%2847%29.jpg',
}

// Couleurs primaires par équipe pour la barre prono
export const TEAM_COLORS = {
  'France':        '#002395',
  'Brazil':        '#009c3b',
  'Argentina':     '#74acdf',
  'Germany':       '#e8e8e8',
  'Spain':         '#c60b1e',
  'Portugal':      '#006600',
  'England':       '#cf091d',
  'Netherlands':   '#ff6200',
  'Morocco':       '#c1272d',
  'Senegal':       '#00853f',
  'Mexico':        '#006847',
  'United States': '#002868',
  'Japan':         '#bc002d',
  'South Korea':   '#c60c30',
  'Australia':     '#ffcd00',
  'Belgium':       '#c60b1e',
  'Croatia':       '#c60b1e',
  'Switzerland':   '#c60b1e',
  'Poland':        '#dc143c',
  'Uruguay':       '#5aaaa8',
  'Canada':        '#d80621',
  'Ecuador':       '#ffd100',
}

export function getTeamPhoto(name) {
  return TEAM_PHOTOS[name] ?? null
}

export function getTeamColor(name) {
  return TEAM_COLORS[name] ?? '#6b7280'
}
