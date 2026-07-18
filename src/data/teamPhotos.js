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
  'England':          { p: '#CF081F', s: '#1a1a1a' },
  'Belgium':          { p: '#000000', s: '#ED2939' },
  'Croatia':          { p: '#C8102E', s: '#003DA5' },
  'Morocco':          { p: '#C1272D', s: '#006233' },
  'Senegal':          { p: '#00853F', s: '#FDEF42' },
  'Mexico':           { p: '#006847', s: '#CE1126' },
  'United States':    { p: '#002868', s: '#B22234' },
  'Japan':            { p: '#BC002D', s: '#1a1a1a' },
  'South Korea':      { p: '#003478', s: '#CD2E3A' },
  // Vert/or (#00843D/#FFB81C) étaient les couleurs SPORTIVES traditionnelles de
  // l'Australie (maillots, symboles nationaux), pas celles du DRAPEAU — même
  // erreur de principe que pour l'Angleterre (voir fix Angleterre) : le drapeau
  // australien est un "Blue Ensign" (bleu marine + Union Jack rouge/blanc +
  // étoiles blanches), aucun vert ni or dedans.
  'Australia':        { p: '#00247D', s: '#FFFFFF' },
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
  'Panama':           { p: '#DA121A', s: '#00478C' },
  'Costa Rica':       { p: '#002B7F', s: '#CE1126' },
  'Canada':           { p: '#D80621', s: '#1a1a1a' },
  'Nigeria':          { p: '#008751', s: '#1a1a1a' },
  'Cameroon':         { p: '#007A5E', s: '#CE1126' },
  "Côte d'Ivoire":    { p: '#F77F00', s: '#009A44' },
  'Ghana':            { p: '#006B3F', s: '#FCD116' },
  'Egypt':            { p: '#CE1126', s: '#1a1a1a' },
  'Tunisia':          { p: '#E70013', s: '#1a1a1a' },
  'South Africa':     { p: '#007A4D', s: '#FFB81C' },
  'Ukraine':          { p: '#005BBB', s: '#FFD500' },
  'Austria':          { p: '#ED2939', s: '#1a1a1a' },
  'Slovakia':         { p: '#003F9E', s: '#CE1126' },
  'New Zealand':      { p: '#CC0000', s: '#1a1a1a' }, // rouge fougère argentée
  'Indonesia':        { p: '#CE1126', s: '#1a1a1a' },
  'Thailand':         { p: '#A51931', s: '#2D2A4A' },
  // Clubs (Ligue 1, PL, etc.)
  'Paris Saint-Germain': { p: '#004170', s: '#DA020E' },
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
  // Aliases football-data.org
  'USA':                   { p: '#002868', s: '#B22234' },
  'Korea Republic':        { p: '#003478', s: '#CD2E3A' },
  'DR Congo':              { p: '#007FFF', s: '#CE1126' },
  'Congo DR':              { p: '#007FFF', s: '#CE1126' },
  'Czechia':               { p: '#D7141A', s: '#003366' },
  'Czech Republic':        { p: '#D7141A', s: '#003366' },
  'Atlético Madrid':       { p: '#C12325', s: '#2C3E86' },
  'Inter':                 { p: '#010E80', s: '#000000' },
  'Milan':                 { p: '#FB090B', s: '#000000' },
  'Tottenham':             { p: '#132257', s: '#FFFFFF' },
  'Dortmund':              { p: '#FDE100', s: '#000000' },
  'Marseille':             { p: '#009BDE', s: '#1a1a1a' },
  'Lyon':                  { p: '#1A5EA2', s: '#D00000' },
  'PSG':                   { p: '#004170', s: '#DA020E' },
  // UEFA — manquants
  'Wales':                 { p: '#C8102E', s: '#006B54' },
  'Scotland':              { p: '#003078', s: '#FFFFFF' },
  'Norway':                { p: '#EF2B2D', s: '#003087' },
  'Sweden':                { p: '#006AA7', s: '#FECC02' },
  'Finland':               { p: '#003580', s: '#FFFFFF' },
  'Serbia':                { p: '#C6363C', s: '#003399' },
  'Romania':               { p: '#002B7F', s: '#FFD700' },
  'Hungary':               { p: '#CE2939', s: '#FFFFFF' },
  'Slovenia':              { p: '#003DA5', s: '#FFFFFF' },
  'Greece':                { p: '#0D5EAF', s: '#FFFFFF' },
  'Albania':               { p: '#E41E20', s: '#000000' },
  'Georgia':               { p: '#D02B27', s: '#FFFFFF' },
  'Bulgaria':              { p: '#008000', s: '#D62612' },
  'Bosnia and Herzegovina':{ p: '#003DA5', s: '#FFD700' },
  'Bosnia & Herzegovina':  { p: '#003DA5', s: '#FFD700' },
  'North Macedonia':       { p: '#CE2028', s: '#F5E400' },
  'Israel':                { p: '#003399', s: '#FFFFFF' },
  'Kazakhstan':            { p: '#00AFCA', s: '#FFD700' },
  'Iceland':               { p: '#003F87', s: '#FFFFFF' },
  'Ireland':               { p: '#169B62', s: '#FF883E' },
  'Luxembourg':            { p: '#EF3340', s: '#00A3E0' },
  'Montenegro':            { p: '#D4AF37', s: '#D21034' },
  'Cyprus':                { p: '#003F87', s: '#FFFFFF' },
  'Lithuania':             { p: '#FDB913', s: '#006A44' },
  'Latvia':                { p: '#9E3039', s: '#FFFFFF' },
  'Estonia':               { p: '#0072CE', s: '#000000' },
  'Belarus':               { p: '#CF101A', s: '#009A44' },
  'Moldova':               { p: '#003DA5', s: '#FFD700' },
  'Armenia':               { p: '#D90012', s: '#F2A800' },
  'Azerbaijan':            { p: '#0092BC', s: '#E8192C' },
  // CONCACAF — manquants
  'Honduras':              { p: '#0073CF', s: '#FFFFFF' },
  'El Salvador':           { p: '#1560BD', s: '#FFFFFF' },
  'Guatemala':             { p: '#4997D0', s: '#FFFFFF' },
  'Nicaragua':             { p: '#003DA5', s: '#FFFFFF' },
  // CONMEBOL — manquants
  // CAF — manquants
  'Algeria':               { p: '#006233', s: '#FFFFFF' },
  'Cape Verde':            { p: '#003893', s: '#CF2B36' },
  'Angola':                { p: '#CC0000', s: '#000000' },
  'Ethiopia':              { p: '#078930', s: '#FCDD09' },
  'Uganda':                { p: '#000000', s: '#FCDC04' },
  'Sudan':                 { p: '#007229', s: '#D21034' },
  'Tanzania':              { p: '#1EB53A', s: '#FCD116' },
  'Benin':                 { p: '#008751', s: '#FCD116' },
  'Gabon':                 { p: '#009E60', s: '#FCD116' },
  'Togo':                  { p: '#006A4E', s: '#FFCE00' },
  'Rwanda':                { p: '#20603D', s: '#FAD201' },
  'Madagascar':            { p: '#FC3D32', s: '#007E3A' },
  'Mozambique':            { p: '#009A44', s: '#FCE100' },
  'Zambia':                { p: '#198A00', s: '#EF7D00' },
  'Zimbabwe':              { p: '#006400', s: '#FFD200' },
  'Namibia':               { p: '#003580', s: '#D21034' },
  'Botswana':              { p: '#75AADB', s: '#000000' },
  'Libya':                 { p: '#000000', s: '#FFFFFF' },
  'Comoros':               { p: '#3A75C4', s: '#3D9A00' },
  'Mauritania':            { p: '#006233', s: '#FFD700' },
  'Eswatini':              { p: '#3E5EB9', s: '#FFD900' },
  'Equatorial Guinea':     { p: '#3E9A00', s: '#E32118' },
  'Central African Republic': { p: '#003082', s: '#BC0026' },
  'Djibouti':              { p: '#6AB2E7', s: '#12AD2B' },
  'Eritrea':               { p: '#4189DD', s: '#4DBB6D' },
  // AFC — manquants
  'Uzbekistan':            { p: '#1EB53A', s: '#0099B5' },
  'Iraq':                  { p: '#CE1126', s: '#007A3D' },
  'Jordan':                { p: '#007A3D', s: '#CE1126' },
  'UAE':                   { p: '#00732F', s: '#FF0000' },
  'United Arab Emirates':  { p: '#00732F', s: '#FF0000' },
  'Kuwait':                { p: '#007A3D', s: '#000000' },
  'Palestine':             { p: '#CE1126', s: '#000000' }, // rouge en primaire
  'Kyrgyzstan':            { p: '#E8112D', s: '#FCE300' },
  'Turkmenistan':          { p: '#2FA862', s: '#FFFFFF' },
  'Bangladesh':            { p: '#006A4E', s: '#F42A41' },
  'Myanmar':               { p: '#FECB00', s: '#34B233' },
  'Cambodia':              { p: '#032EA1', s: '#E00025' },
  'Malaysia':              { p: '#CC0001', s: '#003893' },
  'Philippines':           { p: '#0038A8', s: '#CE1126' },
  'Singapore':             { p: '#EF3340', s: '#FFFFFF' },
  'Vietnam':               { p: '#DA251D', s: '#FFCD00' },
  'China PR':              { p: '#DE2910', s: '#FFDE00' },
  'China':                 { p: '#DE2910', s: '#FFDE00' },
  'Chinese Taipei':        { p: '#003580', s: '#CE1126' },
  'Taiwan':                { p: '#003580', s: '#CE1126' },
  'India':                 { p: '#FF9933', s: '#138808' },
  'Pakistan':              { p: '#01411C', s: '#FFFFFF' },
  'Afghanistan':           { p: '#000000', s: '#D32011' },
  'Sri Lanka':             { p: '#8D153A', s: '#EB7400' },
  'Nepal':                 { p: '#003580', s: '#DC143C' },
  'Mongolia':              { p: '#C4272F', s: '#015197' },
  'North Korea':           { p: '#024FA2', s: '#D61A31' },
  'DPR Korea':             { p: '#024FA2', s: '#D61A31' },
  // OFC
  'Papua New Guinea':      { p: '#000000', s: '#CE1126' },
  'Solomon Islands':       { p: '#0120BC', s: '#009E60' },
  'Vanuatu':               { p: '#009543', s: '#D21034' },
  'Fiji':                  { p: '#68BFE5', s: '#003F87' },
  'Tahiti':                { p: '#003082', s: '#E8112D' },
  // Clubs supplémentaires
  'Bayer Leverkusen':      { p: '#E32221', s: '#000000' },
  'RB Leipzig':            { p: '#CC0927', s: '#001E62' },
  'Eintracht Frankfurt':   { p: '#E1000F', s: '#000000' },
  'VfB Stuttgart':         { p: '#E32219', s: '#FFFFFF' },
  'Wolfsburg':             { p: '#65B32E', s: '#003380' },
  'Freiburg':              { p: '#CC0000', s: '#FFFFFF' },
  'Hoffenheim':            { p: '#1961AC', s: '#FFFFFF' },
  'Mainz 05':              { p: '#C3133E', s: '#FFFFFF' },
  'Bochum':                { p: '#005CA9', s: '#FFFFFF' },
  'Werder Bremen':         { p: '#1D9053', s: '#FFFFFF' },
  'Augsburg':              { p: '#BA3733', s: '#007E40' },
  'Nice':                  { p: '#000000', s: '#D00B10' },
  'Lens':                  { p: '#FFCC00', s: '#C00000' },
  'Rennes':                { p: '#DA291C', s: '#000000' },
  'Lille':                 { p: '#DC001A', s: '#002A64' },
  'Monaco':                { p: '#EE1921', s: '#FFFFFF' },
  'Strasbourg':            { p: '#003087', s: '#C0C0C0' },
  'Nantes':                { p: '#FEDF00', s: '#1A4B83' },
  'Reims':                 { p: '#DC002F', s: '#FFFFFF' },
  'Brest':                 { p: '#C41230', s: '#FFFFFF' },
  'Villarreal':            { p: '#FFE000', s: '#005BAC' },
  'Athletic Club':         { p: '#EE2523', s: '#FFFFFF' },
  'Real Betis':            { p: '#00954C', s: '#FFFFFF' },
  'Real Sociedad':         { p: '#003F91', s: '#FFFFFF' },
  'Sevilla':               { p: '#D2021B', s: '#FFFFFF' },
  'Valencia':              { p: '#000000', s: '#FF7F00' },
  'Celta Vigo':            { p: '#93C3E3', s: '#1A2D6B' },
  'Atalanta':              { p: '#1C4EA0', s: '#000000' },
  'Napoli':                { p: '#009FE3', s: '#FFFFFF' },
  'Lazio':                 { p: '#87CEEB', s: '#FFFFFF' },
  'Fiorentina':            { p: '#7B1CC1', s: '#FFFFFF' },
  'Bologna':               { p: '#BA0C22', s: '#003DA5' },
  'Torino':                { p: '#811A21', s: '#FFFFFF' },
  'Genoa':                 { p: '#AC1C2C', s: '#003DA5' },
  'Verona':                { p: '#FFD700', s: '#003DA5' },
  'Udinese':               { p: '#000000', s: '#FFFFFF' },
  'Cagliari':              { p: '#CF2734', s: '#003DA5' },
  'Celtic':                { p: '#009B4D', s: '#FFFFFF' },
  'Rangers':               { p: '#1B458F', s: '#FFFFFF' },
  'Ajax':                  { p: '#D2122E', s: '#FFFFFF' },
  'Feyenoord':             { p: '#D2122E', s: '#FFFFFF' },
  'Porto':                 { p: '#1E3D8F', s: '#FFD700' },
  'Benfica':               { p: '#CC0000', s: '#FFFFFF' },
  'Sporting CP':           { p: '#006600', s: '#FFD700' },
  'Galatasaray':           { p: '#E82222', s: '#F8C300' },
  'Fenerbahçe':            { p: '#002F6C', s: '#FFB300' },
  'Besiktas':              { p: '#000000', s: '#FFFFFF' },
  'Shakhtar Donetsk':      { p: '#F77F00', s: '#000000' },
  'Dynamo Kyiv':           { p: '#0055A0', s: '#FFFFFF' },
  'Red Bull Salzburg':     { p: '#D40511', s: '#FFFFFF' },
  'PAOK':                  { p: '#000000', s: '#FFFFFF' },
  'Olympiakos':            { p: '#CC0000', s: '#FFFFFF' },
  'Anderlecht':            { p: '#6A0DAD', s: '#FFFFFF' },
  'Club Brugge':           { p: '#003380', s: '#000000' },
  'Copenhagen':            { p: '#003580', s: '#FFFFFF' },
  'Midtjylland':           { p: '#C60C30', s: '#FFFFFF' },
  'Rosenborg':             { p: '#000000', s: '#F5C400' },
  'Malmö':                 { p: '#1B4F9B', s: '#FFFFFF' },
  'AIK':                   { p: '#000000', s: '#F5C400' },
  'Slavia Prague':         { p: '#CC0000', s: '#FFFFFF' },
  'Sparta Prague':         { p: '#AC162C', s: '#FFFFFF' },
  'Legia Warsaw':          { p: '#007C3B', s: '#FFFFFF' },
  // Premier League — manquants
  'Brighton & Hove Albion':{ p: '#0057B8', s: '#FFFFFF' },
  'Brighton':              { p: '#0057B8', s: '#FFFFFF' },
  'Aston Villa':           { p: '#670E36', s: '#95BFE5' },
  'Newcastle United':      { p: '#241F20', s: '#FFFFFF' },
  'Newcastle':             { p: '#241F20', s: '#FFFFFF' },
  'West Ham United':       { p: '#7A263A', s: '#1BB1E7' },
  'West Ham':              { p: '#7A263A', s: '#1BB1E7' },
  'Leicester City':        { p: '#003090', s: '#FDBE11' },
  'Leicester':             { p: '#003090', s: '#FDBE11' },
  'Wolverhampton Wanderers':{ p: '#FDB913', s: '#231F20' },
  'Wolves':                { p: '#FDB913', s: '#231F20' },
  'Crystal Palace':        { p: '#1B458F', s: '#C4122E' },
  'Everton':               { p: '#003399', s: '#FFFFFF' },
  'Brentford':             { p: '#E30613', s: '#FFFFFF' },
  'Fulham':                { p: '#CC0000', s: '#FFFFFF' },
  'Nottingham Forest':     { p: '#DD0000', s: '#FFFFFF' },
  'Nottm Forest':          { p: '#DD0000', s: '#FFFFFF' },
  'Bournemouth':           { p: '#DA291C', s: '#000000' },
  'Southampton':           { p: '#D71920', s: '#130C0E' },
  'Ipswich Town':          { p: '#0057B8', s: '#FFFFFF' },
  'Ipswich':               { p: '#0057B8', s: '#FFFFFF' },
  'Sunderland':            { p: '#EB172B', s: '#1A1A1A' },
  'Sheffield United':      { p: '#EE2737', s: '#1A1A1A' },
  'Sheffield Wednesday':   { p: '#0033A0', s: '#FFFFFF' },
  'Leeds United':          { p: '#FFCD00', s: '#1A1A1A' },
  'Leeds':                 { p: '#FFCD00', s: '#1A1A1A' },
  'Burnley':               { p: '#6C1D45', s: '#99D6EA' },
  'Luton Town':            { p: '#F78F1E', s: '#FFFFFF' },
  'Middlesbrough':         { p: '#E8282D', s: '#FFFFFF' },
  'Blackburn Rovers':      { p: '#009EE0', s: '#FFFFFF' },
  'Stoke City':            { p: '#E03A3E', s: '#1B2A4A' },
  'Derby County':          { p: '#FFFFFF', s: '#000000' },
  'Queens Park Rangers':   { p: '#1D5BA4', s: '#FFFFFF' },
  'QPR':                   { p: '#1D5BA4', s: '#FFFFFF' },
  'Swansea City':          { p: '#121212', s: '#FFFFFF' },
  'Cardiff City':          { p: '#0070B5', s: '#D31245' },
  'Watford':               { p: '#FBEE23', s: '#ED2127' },
  'Norwich City':          { p: '#00A650', s: '#FFF200' },
  // Ligue 1 — manquants
  'Toulouse FC':           { p: '#6B0B8C', s: '#FFFFFF' },
  'Toulouse':              { p: '#6B0B8C', s: '#FFFFFF' },
  'Le Havre':              { p: '#7FC6E4', s: '#FFFFFF' },
  'Montpellier HSC':       { p: '#F4911B', s: '#1D3C6B' },
  'Montpellier':           { p: '#F4911B', s: '#1D3C6B' },
  'Lorient':               { p: '#F76A12', s: '#E2A02A' },
  'Metz':                  { p: '#8C1D40', s: '#F0E000' },
  'Angers SCO':            { p: '#000000', s: '#FFFFFF' },
  'Angers':                { p: '#000000', s: '#FFFFFF' },
  'Stade Brestois 29':     { p: '#C41230', s: '#FFFFFF' },
  'Stade de Reims':        { p: '#DC002F', s: '#FFFFFF' },
  'Havre AC':              { p: '#7FC6E4', s: '#FFFFFF' },
  'Clermont Foot':         { p: '#EE2A25', s: '#5E3E94' },
  'Clermont':              { p: '#EE2A25', s: '#5E3E94' },
  // Bundesliga — manquants
  'FC Union Berlin':       { p: '#DC4422', s: '#FFFFFF' },
  'Union Berlin':          { p: '#DC4422', s: '#FFFFFF' },
  '1. FC Heidenheim 1846': { p: '#E2001A', s: '#003A7E' },
  'Heidenheim':            { p: '#E2001A', s: '#003A7E' },
  'SV Darmstadt 98':       { p: '#005CA9', s: '#FFFFFF' },
  'Darmstadt':             { p: '#005CA9', s: '#FFFFFF' },
  '1. FC Köln':            { p: '#FF0000', s: '#FFFFFF' },
  'Cologne':               { p: '#FF0000', s: '#FFFFFF' },
  'Hamburger SV':          { p: '#0B4FBC', s: '#FFFFFF' },
  'HSV':                   { p: '#0B4FBC', s: '#FFFFFF' },
  'Schalke 04':            { p: '#004D9D', s: '#FFFFFF' },
  'Hertha BSC':            { p: '#003DA5', s: '#FFFFFF' },
  'Greuther Fürth':        { p: '#006633', s: '#FFFFFF' },
  'Fortuna Düsseldorf':    { p: '#E30613', s: '#FFFFFF' },
  // Serie A — manquants
  'Monza':                 { p: '#EF3340', s: '#FFFFFF' },
  'Frosinone Calcio':      { p: '#FCD116', s: '#003082' },
  'Frosinone':             { p: '#FCD116', s: '#003082' },
  'Lecce':                 { p: '#FFD700', s: '#CC0000' },
  'Salernitana':           { p: '#8B0000', s: '#1A1A1A' },
  'Spezia':                { p: '#001F7C', s: '#FFFFFF' },
  'Venezia':               { p: '#FF8800', s: '#006600' },
  'Empoli':                { p: '#003080', s: '#FFFFFF' },
  'Sassuolo':              { p: '#00632B', s: '#000000' },
  'Hellas Verona':         { p: '#FFD700', s: '#003DA5' },
  'Cremonese':             { p: '#DA121A', s: '#8B0000' },
  'Parma':                 { p: '#FFCC00', s: '#003DA5' },
  'Como':                  { p: '#004D9D', s: '#FFFFFF' },
  // LaLiga — manquants
  'Girona':                { p: '#CC0000', s: '#FFFFFF' },
  'Getafe':                { p: '#005DA6', s: '#FFFFFF' },
  'Rayo Vallecano':        { p: '#CC0000', s: '#FFFFFF' },
  'Deportivo Alavés':      { p: '#0063A6', s: '#FFFFFF' },
  'Alaves':                { p: '#0063A6', s: '#FFFFFF' },
  'Mallorca':              { p: '#DD0000', s: '#000000' },
  'Valladolid':            { p: '#6B2D8B', s: '#FFFFFF' },
  'Leganés':               { p: '#004E9A', s: '#FFFFFF' },
  'Las Palmas':            { p: '#FFD700', s: '#002147' },
  'Espanyol':              { p: '#003DA5', s: '#FFFFFF' },
  'Osasuna':               { p: '#CC0000', s: '#003DA5' },
  'Granada':               { p: '#CC0000', s: '#FFFFFF' },
  'Cadiz':                 { p: '#FFD700', s: '#003DA5' },
  // Autres
  'Besiktaş JK':           { p: '#000000', s: '#FFFFFF' },
  'Trabzonspor':           { p: '#810000', s: '#F6EBCF' },
  'Lille OSC':             { p: '#DC001A', s: '#002A64' },
  'Stade Rennais FC':      { p: '#DA291C', s: '#000000' },
  'RC Strasbourg Alsace':  { p: '#003087', s: '#C0C0C0' },
  'FC Nantes':             { p: '#FEDF00', s: '#1A4B83' },
  'OGC Nice':              { p: '#000000', s: '#D00B10' },
  'RC Lens':               { p: '#FFCC00', s: '#C00000' },
  'AS Monaco FC':          { p: '#EE1921', s: '#FFFFFF' },
  'Olympique Lyonnais':    { p: '#1A5EA2', s: '#D00000' },
  'Olympique de Marseille':{ p: '#009BDE', s: '#1a1a1a' },
  // ── WC 2026 — tous les pays qualifiés (variantes de noms football-data.org) ──
  // CONCACAF
  'Trinidad and Tobago':   { p: '#CE1126', s: '#000000' },
  'Trinidad & Tobago':     { p: '#CE1126', s: '#000000' },
  'Curaçao':               { p: '#003087', s: '#FFFFFF' },
  'Curacao':               { p: '#003087', s: '#FFFFFF' },
  'Jamaica':               { p: '#000000', s: '#FED100' },
  'Cuba':                  { p: '#002A8F', s: '#CF142B' },
  'Haiti':                 { p: '#00209F', s: '#D21034' },
  'Haïti':                 { p: '#00209F', s: '#D21034' },
  'Suriname':              { p: '#377E3F', s: '#B40A2D' },
  'Guyana':                { p: '#009E49', s: '#CE1126' },
  'Belize':                { p: '#003F87', s: '#CE1126' },
  'Bermuda':               { p: '#CC0000', s: '#000000' },
  'Cayman Islands':        { p: '#000000', s: '#FFFFFF' },
  'Martinique':            { p: '#003087', s: '#FFFFFF' },
  'Guadeloupe':            { p: '#003DA5', s: '#FFFFFF' },
  // CONMEBOL
  'Bolivia':               { p: '#D52B1E', s: '#F9E300' },
  'Paraguay':              { p: '#D52B1E', s: '#0038A8' },
  'Venezuela':             { p: '#CF142B', s: '#003082' },
  'Peru':                  { p: '#D91023', s: '#1a1a1a' },
  // CAF WC 2026
  'Mali':                  { p: '#14B53A', s: '#FCD116' },
  'Guinea':                { p: '#CE1126', s: '#009A44' },
  'Guinée':                { p: '#CE1126', s: '#009A44' },
  'Équatorial Guinea':     { p: '#3E9A00', s: '#E32118' },
  'Ivory Coast':           { p: '#F77F00', s: '#009A44' },
  'Kenya':                 { p: '#006600', s: '#CC0000' },
  'Sierra Leone':          { p: '#1EB53A', s: '#0000CD' },
  'Liberia':               { p: '#BF0A30', s: '#002868' },
  'Niger':                 { p: '#E05206', s: '#009A44' },
  'Burkina Faso':          { p: '#EF2B2D', s: '#009A3B' },
  'Congo':                 { p: '#009A44', s: '#FBDE4A' },
  'Republic of Congo':     { p: '#009A44', s: '#FBDE4A' },
  'Sénégal':               { p: '#00853F', s: '#FDEF42' },
  'Maroc':                 { p: '#C1272D', s: '#006233' },
  // AFC WC 2026
  'Oman':                  { p: '#DB161B', s: '#FFFFFF' },
  'Bahrain':               { p: '#CE1126', s: '#FFFFFF' },
  'Bahreïn':               { p: '#CE1126', s: '#FFFFFF' },
  'Syria':                 { p: '#007A3D', s: '#CE1126' },
  'Syrie':                 { p: '#007A3D', s: '#CE1126' },
  'Lebanon':               { p: '#CE1126', s: '#FFFFFF' },
  'Liban':                 { p: '#CE1126', s: '#FFFFFF' },
  'Tajikistan':            { p: '#CC0000', s: '#006600' },
  'Kirghizistan':          { p: '#E8112D', s: '#FCE300' },
  // Noms football-data.org alternatifs
  'Islamic Republic of Iran':{ p: '#239F40', s: '#FFFFFF' },
  'Republic of Ireland':   { p: '#169B62', s: '#FF883E' },
  'Northern Ireland':      { p: '#003DA5', s: '#FFFFFF' },
  'Faroe Islands':         { p: '#003F87', s: '#EF3340' },
  'Liechtenstein':         { p: '#002B7F', s: '#CE1126' },
  'Andorra':               { p: '#003DA5', s: '#FEDF00' },
  'Malta':                 { p: '#FFFFFF', s: '#CE1126' },
  'San Marino':            { p: '#003DA5', s: '#FFFFFF' },
  'Gibraltar':             { p: '#FFFFFF', s: '#CE1126' },
  'Kosovo':                { p: '#003DA5', s: '#FFD700' },
  // Aliases supplémentaires
  'Türkiye':               { p: '#E30A17', s: '#1a1a1a' },
  'Turkey':                { p: '#E30A17', s: '#1a1a1a' },
  'Netherlands':           { p: '#FF6200', s: '#003580' },
  'Holland':               { p: '#FF6200', s: '#003580' },
}

// Mots-clés → couleurs pour le fuzzy match
const KEYWORD_COLORS = [
  [['korea'],                    { p: '#003478', s: '#CD2E3A' }],
  [['ivory','ivoire'],           { p: '#F77F00', s: '#009A44' }],
  [['united states','usa'],      { p: '#002868', s: '#B22234' }],
  [['iran'],                     { p: '#239F40', s: '#006B2B' }],
  [['türk','turk'],              { p: '#E30A17', s: '#1a1a1a' }],
  [['czech','tchèque'],          { p: '#D7141A', s: '#003366' }],
  [['congo'],                    { p: '#007FFF', s: '#CE1126' }],
  [['saudi'],                    { p: '#006C35', s: '#1a1a1a' }],
  [['new zealand','nouvelle-zélande'],{ p: '#1a1a1a', s: '#CC0000' }],
  [['south africa','afrique du sud'],  { p: '#007A4D', s: '#FFB81C' }],
  [['costa rica'],               { p: '#002B7F', s: '#CE1126' }],
  [['trinidad'],                 { p: '#CE1126', s: '#000000' }],
  [['el salvador'],              { p: '#1560BD', s: '#FFFFFF' }],
  [['paraguay'],                 { p: '#D52B1E', s: '#0038A8' }],
  [['iraq'],                     { p: '#CE1126', s: '#007A3D' }],
  [['uzbek'],                    { p: '#1EB53A', s: '#0099B5' }],
  [['bahrain'],                  { p: '#CE1126', s: '#FFFFFF' }],
  [['oman'],                     { p: '#DB161B', s: '#FFFFFF' }],
  [['jordan'],                   { p: '#007A3D', s: '#CE1126' }],
  [['philippines'],              { p: '#0038A8', s: '#CE1126' }],
  [['vietnam'],                  { p: '#DA251D', s: '#FFCD00' }],
  [['thailand','thaïlande'],     { p: '#A51931', s: '#2D2A4A' }],
  [['myanmar'],                  { p: '#FECB00', s: '#34B233' }],
  [['indonesia'],                { p: '#CE1126', s: '#1a1a1a' }],
  [['malaysia'],                 { p: '#CC0001', s: '#003893' }],
  [['guatemala'],                { p: '#4997D0', s: '#FFFFFF' }],
  [['honduras'],                 { p: '#0073CF', s: '#1a1a1a' }],
  [['cuba'],                     { p: '#002A8F', s: '#CF142B' }],
  [['haiti'],                    { p: '#00209F', s: '#D21034' }],
  [['suriname'],                 { p: '#377E3F', s: '#B40A2D' }],
  [['zimbabwe'],                 { p: '#006400', s: '#FFD200' }],
  [['zambia'],                   { p: '#198A00', s: '#EF7D00' }],
  [['tanzania'],                 { p: '#1EB53A', s: '#FCD116' }],
  [['mali'],                     { p: '#14B53A', s: '#FCD116' }],
  [['guinea'],                   { p: '#CE1126', s: '#FCD116' }],
  [['libya'],                    { p: '#000000', s: '#FFFFFF' }],
  [['comoros'],                  { p: '#3A75C4', s: '#3D9A00' }],
  [['mauritania'],               { p: '#006233', s: '#FFD700' }],
  [['mozambique'],               { p: '#009A44', s: '#FCE100' }],
  // UEFA fuzzy
  [['wales','cymru'],            { p: '#C8102E', s: '#006B54' }],
  [['scotland'],                 { p: '#003078', s: '#FFFFFF' }],
  [['norway','norvège'],         { p: '#EF2B2D', s: '#003087' }],
  [['sweden','suède','sverige'], { p: '#006AA7', s: '#FECC02' }],
  [['finland','finlande'],       { p: '#003580', s: '#FFFFFF' }],
  [['serbia','serbie'],          { p: '#C6363C', s: '#003399' }],
  [['romania','roumanie'],       { p: '#002B7F', s: '#FFD700' }],
  [['hungary','hongrie'],        { p: '#CE2939', s: '#FFFFFF' }],
  [['slovenia','slovénie'],      { p: '#003DA5', s: '#FFFFFF' }],
  [['greece','grèce'],           { p: '#0D5EAF', s: '#FFFFFF' }],
  [['albania','albanie'],        { p: '#E41E20', s: '#000000' }],
  [['georgia','géorgie'],        { p: '#D02B27', s: '#FFFFFF' }],
  [['bulgaria','bulgarie'],      { p: '#008000', s: '#D62612' }],
  [['bosnia'],                   { p: '#003DA5', s: '#FFD700' }],
  [['macedonia'],                { p: '#CE2028', s: '#F5E400' }],
  [['kosovo'],                   { p: '#003DA5', s: '#FFD700' }],
  [['iceland','islande'],        { p: '#003F87', s: '#FFFFFF' }],
  [['ireland'],                  { p: '#169B62', s: '#FF883E' }],
  [['armenia'],                  { p: '#D90012', s: '#F2A800' }],
  [['azerbaijan'],               { p: '#0092BC', s: '#E8192C' }],
  [['kazakhstan'],               { p: '#00AFCA', s: '#FFD700' }],
  // CONCACAF fuzzy
  [['el salvador'],              { p: '#1560BD', s: '#FFFFFF' }],
  [['trinidad'],                 { p: '#CE1126', s: '#000000' }],
  [['nicaragua'],                { p: '#003DA5', s: '#FFFFFF' }],
  // AFC fuzzy
  [['uzbek'],                    { p: '#1EB53A', s: '#0099B5' }],
  [['china'],                    { p: '#DE2910', s: '#FFDE00' }],
  [['india'],                    { p: '#FF9933', s: '#138808' }],
  [['north korea','dpr korea'],  { p: '#024FA2', s: '#D61A31' }],
  [['uae','emirates'],           { p: '#00732F', s: '#FF0000' }],
  [['kuwait'],                   { p: '#007A3D', s: '#000000' }],
  [['palestine'],                { p: '#000000', s: '#CE1126' }],
  // CAF fuzzy
  [['cape verde','cabo verde'],  { p: '#003893', s: '#CF2B36' }],
  [['burkina'],                  { p: '#EF2B2D', s: '#009A3B' }],
  [['angola'],                   { p: '#CC0000', s: '#000000' }],
  [['ethiopia','éthiopie'],      { p: '#078930', s: '#FCDD09' }],
  [['uganda','ouganda'],         { p: '#000000', s: '#FCDC04' }],
  [['benin','bénin'],            { p: '#008751', s: '#FCD116' }],
  [['gabon'],                    { p: '#009E60', s: '#FCD116' }],
  [['togo'],                     { p: '#006A4E', s: '#FFCE00' }],
  [['rwanda'],                   { p: '#20603D', s: '#FAD201' }],
  [['madagascar'],               { p: '#FC3D32', s: '#007E3A' }],
  [['namibia','namibie'],        { p: '#003580', s: '#D21034' }],
  [['botswana'],                 { p: '#75AADB', s: '#000000' }],
  [['eswatini','swaziland'],     { p: '#3E5EB9', s: '#FFD900' }],
  [['equatorial guinea'],        { p: '#3E9A00', s: '#E32118' }],
  [['eritrea'],                  { p: '#4189DD', s: '#4DBB6D' }],
  [['djibouti'],                 { p: '#6AB2E7', s: '#12AD2B' }],
  [['lesotho'],                  { p: '#009A44', s: '#FFFFFF' }],
  // WC 2026 CONCACAF — noms spéciaux football-data.org
  [['cura'],                     { p: '#003087', s: '#FFFFFF' }],  // Curaçao
  [['guyana'],                   { p: '#009E49', s: '#CE1126' }],
  [['jamaica'],                  { p: '#000000', s: '#FED100' }],
  [['belize'],                   { p: '#003F87', s: '#CE1126' }],
  [['bermuda'],                  { p: '#CC0000', s: '#000000' }],
  [['martinique'],               { p: '#003087', s: '#FFFFFF' }],
  [['guadeloupe'],               { p: '#003DA5', s: '#FFFFFF' }],
  [['barbados','barbade'],       { p: '#00267F', s: '#FFC726' }],
  [['montserrat'],               { p: '#002868', s: '#000000' }],
  [['st. lucia','saint lucia'],  { p: '#65CFFF', s: '#FCD116' }],
  [['grenada','grenade'],        { p: '#CE1126', s: '#009E60' }],
  [['antigua'],                  { p: '#CE1126', s: '#000000' }],
  [['saint kitts'],              { p: '#009E60', s: '#FFD700' }],
  [['st. kitts'],                { p: '#009E60', s: '#FFD700' }],
  [['dominican'],                { p: '#002D62', s: '#CF142B' }],
  // WC 2026 AFC
  [['syria','syrie'],            { p: '#007A3D', s: '#CE1126' }],
  [['lebanon','liban'],          { p: '#CE1126', s: '#FFFFFF' }],
  [['tajik'],                    { p: '#CC0000', s: '#006600' }],
  [['kyrgyz','kirghiz'],         { p: '#E8112D', s: '#FCE300' }],
  // WC 2026 CAF — noms alternatifs
  [['maroc'],                    { p: '#C1272D', s: '#006233' }],
  [['sénégal','senegal'],        { p: '#00853F', s: '#FDEF42' }],
  [['liberia'],                  { p: '#BF0A30', s: '#002868' }],
  [['kenya'],                    { p: '#006600', s: '#CC0000' }],
  [['sierra leone'],             { p: '#1EB53A', s: '#0000CD' }],
  [['niger'],                    { p: '#E05206', s: '#009A44' }],
  // Netherlands variants
  [['netherlands','holland','pays-bas'], { p: '#FF6200', s: '#003580' }],
  // Premier League clubs fuzzy
  [['brighton'],                 { p: '#0057B8', s: '#FFFFFF' }],
  [['aston villa'],              { p: '#670E36', s: '#95BFE5' }],
  [['newcastle'],                { p: '#241F20', s: '#FFFFFF' }],
  [['west ham'],                 { p: '#7A263A', s: '#1BB1E7' }],
  [['leicester'],                { p: '#003090', s: '#FDBE11' }],
  [['wolverhampton','wolves'],   { p: '#FDB913', s: '#231F20' }],
  [['crystal palace'],           { p: '#1B458F', s: '#C4122E' }],
  [['everton'],                  { p: '#003399', s: '#FFFFFF' }],
  [['brentford'],                { p: '#E30613', s: '#FFFFFF' }],
  [['fulham'],                   { p: '#CC0000', s: '#FFFFFF' }],
  [['nottingham','nottm'],       { p: '#DD0000', s: '#FFFFFF' }],
  [['bournemouth'],              { p: '#DA291C', s: '#000000' }],
  [['southampton'],              { p: '#D71920', s: '#130C0E' }],
  [['ipswich'],                  { p: '#0057B8', s: '#FFFFFF' }],
  [['sunderland'],               { p: '#EB172B', s: '#1A1A1A' }],
  [['leeds'],                    { p: '#FFCD00', s: '#1A1A1A' }],
  [['burnley'],                  { p: '#6C1D45', s: '#99D6EA' }],
  [['luton'],                    { p: '#F78F1E', s: '#FFFFFF' }],
  [['watford'],                  { p: '#FBEE23', s: '#ED2127' }],
  [['norwich'],                  { p: '#00A650', s: '#FFF200' }],
  [['swansea'],                  { p: '#121212', s: '#FFFFFF' }],
  [['cardiff'],                  { p: '#0070B5', s: '#D31245' }],
  [['sheffield'],                { p: '#EE2737', s: '#1A1A1A' }],
  [['middlesbrough'],            { p: '#E8282D', s: '#FFFFFF' }],
  [['blackburn'],                { p: '#009EE0', s: '#FFFFFF' }],
  [['stoke'],                    { p: '#E03A3E', s: '#1B2A4A' }],
  // Ligue 1 fuzzy
  [['toulouse'],                 { p: '#6B0B8C', s: '#FFFFFF' }],
  [['havre','le havre'],         { p: '#7FC6E4', s: '#FFFFFF' }],
  [['montpellier'],              { p: '#F4911B', s: '#1D3C6B' }],
  [['lorient'],                  { p: '#F76A12', s: '#E2A02A' }],
  [['metz'],                     { p: '#8C1D40', s: '#F0E000' }],
  [['angers'],                   { p: '#000000', s: '#FFFFFF' }],
  [['clermont'],                 { p: '#EE2A25', s: '#5E3E94' }],
  // Bundesliga fuzzy
  [['union berlin'],             { p: '#DC4422', s: '#FFFFFF' }],
  [['heidenheim'],               { p: '#E2001A', s: '#003A7E' }],
  [['darmstadt'],                { p: '#005CA9', s: '#FFFFFF' }],
  [['köln','cologne','koeln'],   { p: '#FF0000', s: '#FFFFFF' }],
  [['hamburger','hsv'],          { p: '#0B4FBC', s: '#FFFFFF' }],
  [['schalke'],                  { p: '#004D9D', s: '#FFFFFF' }],
  [['hertha'],                   { p: '#003DA5', s: '#FFFFFF' }],
  [['fortuna'],                  { p: '#E30613', s: '#FFFFFF' }],
  // Serie A fuzzy
  [['monza'],                    { p: '#EF3340', s: '#FFFFFF' }],
  [['frosinone'],                { p: '#FCD116', s: '#003082' }],
  [['lecce'],                    { p: '#FFD700', s: '#CC0000' }],
  [['salernitana'],              { p: '#8B0000', s: '#1A1A1A' }],
  [['venezia'],                  { p: '#FF8800', s: '#006600' }],
  [['empoli'],                   { p: '#003080', s: '#FFFFFF' }],
  [['sassuolo'],                 { p: '#00632B', s: '#000000' }],
  [['cremonese'],                { p: '#DA121A', s: '#8B0000' }],
  [['parma'],                    { p: '#FFCC00', s: '#003DA5' }],
  [['como'],                     { p: '#004D9D', s: '#FFFFFF' }],
  // LaLiga fuzzy
  [['girona'],                   { p: '#CC0000', s: '#FFFFFF' }],
  [['getafe'],                   { p: '#005DA6', s: '#FFFFFF' }],
  [['rayo'],                     { p: '#CC0000', s: '#FFFFFF' }],
  [['alav'],                     { p: '#0063A6', s: '#FFFFFF' }],
  [['mallorca'],                 { p: '#DD0000', s: '#000000' }],
  [['valladolid'],               { p: '#6B2D8B', s: '#FFFFFF' }],
  [['leganes','leganés'],        { p: '#004E9A', s: '#FFFFFF' }],
  [['las palmas'],               { p: '#FFD700', s: '#002147' }],
  [['espanyol'],                 { p: '#003DA5', s: '#FFFFFF' }],
  [['osasuna'],                  { p: '#CC0000', s: '#003DA5' }],
  [['granada'],                  { p: '#CC0000', s: '#FFFFFF' }],
  [['cadiz','cádiz'],            { p: '#FFD700', s: '#003DA5' }],
]

function normalizeTeamKey(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(fc|cf|afc|sc|ac|as|rc|cd|ud|rcd|ssc|sl|sv|vfb|olympique|stade)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|de|du|des|la|le|los|las|club|football|calcio)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const NORMALIZED_TEAM_COLORS = Object.entries(TEAM_COLORS_FULL).reduce((acc, [name, colors]) => {
  const key = normalizeTeamKey(name)
  if (key && !acc[key]) acc[key] = colors
  return acc
}, {})

// Cherche la couleur d'une équipe : exact → normalisé → fuzzy → null
function lookupColor(name) {
  if (!name) return null
  // 1. Exact
  if (TEAM_COLORS_FULL[name]) return TEAM_COLORS_FULL[name]
  // 2. Normalisé : accents, ponctuation, préfixes clubs, articles.
  const normalized = normalizeTeamKey(name)
  if (NORMALIZED_TEAM_COLORS[normalized]) return NORMALIZED_TEAM_COLORS[normalized]
  // 3. Strip préfixe club (FC, AS, AC...)
  const stripped = name.replace(/^(FC|AS|AC|SSC|SL|RC|SC|CD|CF|UD|RCD|GD|NK|FK|SK|BK|IK|HNK|CA|CF|SD|UD)\s+/i, '')
  if (TEAM_COLORS_FULL[stripped]) return TEAM_COLORS_FULL[stripped]
  const normalizedStripped = normalizeTeamKey(stripped)
  if (NORMALIZED_TEAM_COLORS[normalizedStripped]) return NORMALIZED_TEAM_COLORS[normalizedStripped]
  // 4. Fuzzy : un des mots-clés contenu dans le nom
  const n = normalizeTeamKey(name)
  for (const [keywords, colors] of KEYWORD_COLORS) {
    if (keywords.some(kw => n.includes(normalizeTeamKey(kw)))) return colors
  }
  return null
}

// S'assure qu'une couleur hex n'est pas trop sombre pour être visible dans un dégradé
function ensureVisible(hex, fallbackHex) {
  try {
    const r = parseInt(hex.slice(1,3),16)
    const g = parseInt(hex.slice(3,5),16)
    const b = parseInt(hex.slice(5,7),16)
    // Luminance perceptive (0-255)
    const lum = (r * 299 + g * 587 + b * 114) / 1000
    if (lum < 40) return fallbackHex // trop sombre → utiliser le fallback
    return hex
  } catch { return fallbackHex }
}

// '#1a1a1a' est utilisé dans TEAM_COLORS_FULL comme repli générique quand une
// équipe n'a pas de vraie 2e couleur identitaire (ex: Pérou, Canada, Danemark,
// Suisse — tous rouge/blanc, aucun noir dans leur drapeau/maillot). Ce n'est
// jamais un vrai choix curé : l'afficher comme ton de dégradé n'a aucun sens.
// À l'inverse, '#000000' (noir pur) EST un choix volontaire dans ce fichier
// pour les équipes dont le noir fait vraiment partie de l'identité (Belgique,
// Jamaïque, Juventus, Udinese...) — celui-là doit être respecté tel quel.
const GENERIC_DARK_FILLER = '#1a1a1a'
function ensureAccentVisible(hex, fallbackHex) {
  if (!hex) return fallbackHex
  return hex.toLowerCase() === GENERIC_DARK_FILLER ? fallbackHex : hex
}

// ── Anti-collision de couleurs ─────────────────────────────────────────────────
// Si les 2 équipes ont la même couleur "famille" (ex: rouge vs rouge), le dégradé/
// la barre prono devient illisible (on ne distingue plus qui est qui). On classe
// chaque couleur dans une famille (rouge, bleu, vert…) et, en cas de collision,
// on garde la couleur principale à l'équipe qui l'a la plus dominante (saturation
// la plus forte = couleur la plus "pure"/vive) et on bascule l'autre équipe sur
// sa couleur secondaire (ou un repli distinct si la secondaire collisionne aussi).
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4; break
    }
    h *= 60
  }
  return { h, s, l }
}

function colorFamily(hex) {
  try {
    const { h, s, l } = hexToHsl(hex)
    if (l < 0.16) return 'black'
    if (l > 0.88 && s < 0.25) return 'white'
    if (s < 0.15) return 'gray'
    if (h < 15 || h >= 345) return 'red'
    if (h < 45)  return 'orange'
    if (h < 70)  return 'yellow'
    if (h < 170) return 'green'
    if (h < 200) return 'cyan'
    if (h < 255) return 'blue'
    if (h < 290) return 'purple'
    return 'pink'
  } catch { return null }
}

/**
 * Résout les couleurs "dom"/"ext" d'un match en évitant qu'elles tombent dans
 * la même famille de couleur (ex: rouge vs rouge). Retourne pour chaque équipe
 * { main, accent } :
 *   main   → couleur mise en avant (celle utilisée pour la barre prono, la bordure…)
 *   accent → l'autre couleur curée de l'équipe (utilisée en 2ème ton dans le dégradé,
 *            pour refléter le vrai drapeau au lieu d'un aplat unique — ex: une équipe
 *            rouge/blanc affichera un vrai dégradé rouge→blanc→rouge plutôt que du
 *            rouge plat, ce qui limite l'effet "tout se ressemble en rouge/vert").
 */
export function getMatchTeamColors(homeName, awayName) {
  // On distingue "équipe vraiment inconnue" (aucune entrée curée trouvée par
  // lookupColor, ex: petite sélection absente du dico) de "équipe connue" —
  // c'est le repli fabriqué (fallbackColor, une couleur choisie par hash du
  // nom, sans AUCUN rapport avec le vrai drapeau) qui ne doit servir QUE dans
  // le 1er cas. Bug corrigé : plus bas, en cas de double collision (main ET
  // secondaire de l'équipe dans la même famille que l'adversaire), l'ancien
  // code retombait sur ce repli inventé même pour une équipe dont on a les
  // vraies couleurs (ex: Argentine, bleu/bleu face à une autre équipe bleue)
  // → un pays sans vert dans son drapeau pouvait afficher du vert au hasard.
  const knownHome = lookupColor(homeName)
  const knownAway = lookupColor(awayName)
  const fallbackHome = fallbackColor(homeName, 0)
  const fallbackAway = fallbackColor(awayName, 1)
  const rawHome = knownHome ?? fallbackHome
  const rawAway = knownAway ?? fallbackAway

  let hp = ensureVisible(rawHome.p, rawHome.s ?? fallbackHome.p)
  let ap = ensureVisible(rawAway.p, rawAway.s ?? fallbackAway.p)
  // Accent = l'autre couleur curée de l'équipe (celle qui n'est pas devenue "main").
  // Beaucoup d'équipes ont une secondaire quasi-noire (#1a1a1a) utilisée comme neutre
  // de remplissage dans TEAM_COLORS_FULL, jamais pensée pour être un ton de dégradé
  // visible → sans ce garde-fou elle rendait des bords de dégradé noirs au lieu de
  // clairs. On applique le même filtre de luminance que sur "main", avec repli blanc
  // (le blanc est un vrai ton de drapeau très fréquent, cohérent avec l'objectif
  // initial de refléter les vraies couleurs des drapeaux).
  let hAccent = ensureAccentVisible((hp === rawHome.p ? rawHome.s : rawHome.p) ?? fallbackHome.s, '#eef2f7')
  let aAccent = ensureAccentVisible((ap === rawAway.p ? rawAway.s : rawAway.p) ?? fallbackAway.s, '#eef2f7')

  const famHome = colorFamily(hp)
  const famAway = colorFamily(ap)

  if (famHome && famHome === famAway) {
    // La couleur la moins saturée (moins "pure") cède la place à sa secondaire
    const satHome = hexToHsl(hp).s
    const satAway = hexToHsl(ap).s
    if (satAway > satHome) {
      const alt = ensureVisible(rawHome.s ?? fallbackHome.s ?? fallbackHome.p, fallbackHome.p)
      // Équipe connue : même si "alt" reste dans la même famille que l'adversaire
      // (double collision, cas rare), on garde une vraie couleur de cette équipe
      // plutôt que d'inventer une teinte au hasard. Le repli aléatoire ne
      // s'applique qu'aux équipes réellement absentes du dico de couleurs.
      hp = (colorFamily(alt) !== famAway || knownHome) ? alt : fallbackHome.p
      hAccent = ensureAccentVisible(rawHome.p ?? fallbackHome.p, '#eef2f7')
    } else {
      const alt = ensureVisible(rawAway.s ?? fallbackAway.s ?? fallbackAway.p, fallbackAway.p)
      ap = (colorFamily(alt) !== famHome || knownAway) ? alt : fallbackAway.p
      aAccent = ensureAccentVisible(rawAway.p ?? fallbackAway.p, '#eef2f7')
    }
  }

  return {
    home: { main: hp, accent: hAccent ?? hp },
    away: { main: ap, accent: aAccent ?? ap },
  }
}

// Construit le dégradé CSS à partir des couleurs résolues (main + accent par équipe).
// 6 arrêts : accent dom → dom → assombri dom → assombri ext → ext → accent ext.
// Donne un vrai dégradé "2 tons par équipe" fidèle aux couleurs curées de chacune,
// plutôt qu'un aplat unique — accepte aussi l'ancien format (chaîne hex simple)
// pour rester compatible avec un appel direct.
export function buildMatchGradient(home, away) {
  const h = typeof home === 'string' ? { main: home, accent: home } : home
  const a = typeof away === 'string' ? { main: away, accent: away } : away
  return `linear-gradient(135deg, ${h.accent} 0%, ${h.main} 24%, ${darken(h.main)} 42%, ${darken(a.main)} 58%, ${a.main} 76%, ${a.accent} 100%)`
}

// Variante "inversée" : les rôles main/accent sont échangés pour chaque équipe.
// Utilisée en crossfade STATIQUE avec buildMatchGradient (voir MatchPoster.jsx) :
// les deux dégradés sont peints une seule fois, seule leur opacity + leur
// transform sont animées ensuite — ce sont les 2 SEULES propriétés qu'un
// navigateur peut animer sur le compositeur GPU sans jamais redéclencher de
// repaint (contrairement à background-position ou à une couleur de dégradé
// qui change dans le temps, qui repaint à chaque frame même sur 1 seul calque).
export function buildMatchGradientAlt(home, away) {
  const h = typeof home === 'string' ? { main: home, accent: home } : home
  const a = typeof away === 'string' ? { main: away, accent: away } : away
  return `linear-gradient(135deg, ${h.main} 0%, ${h.accent} 24%, ${darken(h.accent)} 42%, ${darken(a.accent)} 58%, ${a.accent} 76%, ${a.main} 100%)`
}

// Dégradé unique pour chaque match : couleurs des deux équipes (main + accent)
export function getMatchGradient(homeName, awayName) {
  const { home, away } = getMatchTeamColors(homeName, awayName)
  return buildMatchGradient(home, away)
}

// Génère une couleur de fallback non-noire, unique par nom d'équipe
const FALLBACK_PALETTES = [
  { p: '#1a5fc8', s: '#4a9ef5' }, // bleu vif
  { p: '#0e9e4a', s: '#28d972' }, // vert vif
  { p: '#c8221a', s: '#f04a42' }, // rouge vif
  { p: '#7a22c8', s: '#b04af5' }, // violet vif
  { p: '#c87818', s: '#f0a840' }, // orange vif
  { p: '#0e96a0', s: '#28ccd8' }, // teal vif
  { p: '#c8246e', s: '#f04aa0' }, // rose vif
  { p: '#2a8c18', s: '#50d030' }, // vert clair
]
function fallbackColor(name, seed) {
  if (!name) return FALLBACK_PALETTES[seed % FALLBACK_PALETTES.length]
  let h = seed
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xff
  return FALLBACK_PALETTES[h % FALLBACK_PALETTES.length]
}

// Assombrit légèrement une couleur hex pour le centre du dégradé
// Plancher à 30 sur chaque canal pour éviter le noir quasi-total sur couleurs sombres
function darken(hex) {
  try {
    const r = Math.max(30, parseInt(hex.slice(1,3),16) - 22)
    const g = Math.max(30, parseInt(hex.slice(3,5),16) - 22)
    const b = Math.max(30, parseInt(hex.slice(5,7),16) - 22)
    return `rgb(${r},${g},${b})`
  } catch { return '#1a1a2e' }
}

export function getTeamPhoto(name) {
  return TEAM_PHOTOS[name] ?? null
}

export function getTeamColor(name) {
  return lookupColor(name)?.p ?? fallbackColor(name, 0).p
}

// Convertit un hex '#rrggbb' en triplet "r, g, b" utilisable dans rgba(var(--x), a)
// — même convention que --red-rgb déjà utilisée partout dans les CSS de l'appli.
export function hexToRgbTriplet(hex) {
  try {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    if ([r, g, b].some(Number.isNaN)) throw new Error('invalid hex')
    return `${r}, ${g}, ${b}`
  } catch {
    return '239, 68, 68' // repli = --red-rgb
  }
}

// Variables CSS --match-home/--match-away (+ leurs variantes -rgb pour rgba())
// à poser en style inline sur le conteneur de page/modale — thème dynamique
// aux couleurs des 2 équipes, avec anti-collision déjà géré par
// getMatchTeamColors (jamais la même couleur des deux côtés).
export function getMatchThemeVars(homeName, awayName) {
  const { home, away } = getMatchTeamColors(homeName, awayName)
  return {
    '--match-home':     home.main,
    '--match-home-rgb': hexToRgbTriplet(home.main),
    '--match-away':     away.main,
    '--match-away-rgb': hexToRgbTriplet(away.main),
  }
}
