export const radioStations = [
  {id:'reggaeton-fm', kbps:128, name:'Reggaeton FM', genre:'Reguetón latino', url:'https://reggaeton-fm.stream.laut.fm/reggaeton-fm'},
  {id:'mambo-inn', kbps:320, name:'Mambo INN · Lima', genre:'Salsa', url:'https://radio.perustream.com:7000/stream'},
  {id:'rock-es', kbps:195, name:'Rock en Español', genre:'Rock en español', url:'https://stream.zeno.fm/0vgy8qv3feruv'},
  {id:'rock-80', kbps:128, name:'Rock Antenne · 80er Rock', genre:'Rock de los 80', url:'https://stream.rockantenne.de/80er-rock/stream/mp3'},
  {id:'oldschool', kbps:128, name:'bigFM · Oldschool Rap', genre:'Hip hop en inglés', url:'https://stream.bigfm.de/oldschoolrap/aac-128/liveradioie'},
  {id:'power-181', kbps:128, name:'Power 181 · Top 40', genre:'Pop en inglés', url:'https://listen.181fm.com/181-power_128k.mp3'},
  {id:'italo-80', kbps:66, name:'80s80s · Italo Disco', genre:'Disco de los 80', url:'https://streams.80s80s.de/italohits/aac-64/streams.80s80s.de/'},
  {id:'tech-house', kbps:128, name:'Tech House · laut.fm', genre:'Electrónica', url:'https://tech-house.stream.laut.fm/tech-house'},
  {id:'sunshine-edm', kbps:65, name:'SUNSHINE LIVE · EDM', genre:'Electrónica', url:'https://stream.sunshine-live.de/edm/aac-64/stream.sunshine-live.de/'},
  {id:'seven-soul', kbps:160, name:'SomaFM · Seven Inch Soul', genre:'Funk y soul', url:'https://ice2.somafm.com/7soul-128-mp3'},
];

// Old clients and queues may still reference a retired channel.
const retiredStations = [
  {id:'groove-salad', name:'SomaFM · Groove Salad', genre:'Electrónica chill', url:'https://ice2.somafm.com/groovesalad-128-mp3'},
];

export function stationById(id) {
  return radioStations.find(station => station.id === id) ?? retiredStations.find(station => station.id === id);
}
