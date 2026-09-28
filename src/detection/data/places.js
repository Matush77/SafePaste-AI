// Countries and major cities. A place name alone is not personal data; the
// engine only redacts one when it appears next to other personal data (see
// promoteNearPersonalData in ../index.js).

const PLACES = `
Afghanistan|Albania|Algeria|Argentina|Armenia|Australia|Austria|Azerbaijan|Bahrain|Bangladesh|Belarus|Belgium|Bolivia|
Bosnia|Brazil|Bulgaria|Cambodia|Cameroon|Canada|Chile|China|Colombia|Costa Rica|Croatia|Cuba|Cyprus|Czechia|Czech Republic|
Denmark|Ecuador|Egypt|Estonia|Ethiopia|Finland|France|Georgia|Germany|Ghana|Greece|Guatemala|Hungary|Iceland|India|
Indonesia|Iran|Iraq|Ireland|Israel|Italy|Japan|Jordan|Kazakhstan|Kenya|Kosovo|Kuwait|Latvia|Lebanon|Lithuania|Luxembourg|
Malaysia|Malta|Mexico|Moldova|Montenegro|Morocco|Nepal|Netherlands|New Zealand|Nigeria|North Macedonia|Norway|Oman|
Pakistan|Panama|Peru|Philippines|Poland|Portugal|Qatar|Romania|Russia|Rwanda|Saudi Arabia|Senegal|Serbia|Singapore|
Slovakia|Slovenia|South Africa|South Korea|Korea|Spain|Sri Lanka|Sweden|Switzerland|Taiwan|Tanzania|Thailand|Tunisia|
Turkey|Türkiye|Uganda|Ukraine|United Arab Emirates|United Kingdom|United States|Uruguay|Uzbekistan|Venezuela|
Vietnam|Zambia|Zimbabwe|England|Scotland|Wales|
Amsterdam|Antwerp|Athens|Atlanta|Auckland|Austin|Baltimore|Bangkok|Barcelona|Beijing|Belfast|Belgrade|Bengaluru|Bangalore|
Berlin|Bern|Bilbao|Birmingham|Bogotá|Bologna|Bordeaux|Boston|Bratislava|Brisbane|Bristol|Brno|Brussels|Bucharest|Budapest|
Buenos Aires|Cairo|Calgary|Cambridge|Cape Town|Cardiff|Charlotte|Chennai|Chicago|Cologne|Copenhagen|Cork|Dallas|Delhi|
New Delhi|Denver|Detroit|Doha|Dubai|Dublin|Düsseldorf|Edinburgh|Florence|Frankfurt|Geneva|Genoa|Glasgow|Gothenburg|Graz|
Guangzhou|Hamburg|Hanoi|Helsinki|Ho Chi Minh City|Hong Kong|Houston|Hyderabad|Istanbul|Jakarta|Johannesburg|Karachi|
Kathmandu|Katowice|Kharkiv|Kyiv|Kiev|Košice|Kosice|Krakow|Kraków|Kuala Lumpur|Lagos|Las Vegas|Leeds|Leipzig|Lille|Lima|
Lisbon|Lisboa|Liverpool|Ljubljana|London|Los Angeles|Lyon|Madrid|Malmö|Manchester|Manila|Marseille|Melbourne|Mexico City|
Miami|Milan|Milano|Minneapolis|Montreal|Moscow|Mumbai|Munich|München|Nairobi|Naples|Nashville|New York|Nice|Nitra|
Nuremberg|Odesa|Osaka|Oslo|Ostrava|Ottawa|Oxford|Palermo|Paris|Perth|Philadelphia|Phoenix|Pittsburgh|Portland|Porto|
Prague|Praha|Pune|Reykjavik|Riga|Rio de Janeiro|Rome|Roma|Rotterdam|Salzburg|San Diego|San Francisco|San Jose|Santiago|
São Paulo|Sao Paulo|Sarajevo|Seattle|Seoul|Seville|Shanghai|Shenzhen|Singapore|Skopje|Sofia|Stockholm|Stuttgart|Sydney|
Taipei|Tallinn|Tampa|Tbilisi|Tel Aviv|Thessaloniki|Tirana|Tokyo|Toronto|Toulouse|Trnava|Turin|Utrecht|Valencia|Vancouver|
Venice|Vienna|Wien|Vilnius|Warsaw|Warszawa|Washington|Wellington|Wrocław|Wroclaw|Yerevan|Zagreb|Žilina|Zilina|Zurich|Zürich
`;

/** @type {string[]} */
export const PLACE_NAMES = PLACES.split("|").map((name) => name.trim()).filter(Boolean);
