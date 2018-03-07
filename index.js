const opbeat = require('opbeat').start();
const express = require('express');
const cors = require('cors');
const paginate = require('express-paginate');
const eshop = require('nintendo-switch-eshop');
const compression = require('compression');
const _map = require('lodash/map');
const _find = require('lodash/find');


const app = express();

let games = {};

const getPricesAmerica = async country => {
  const nsuids = _map(games, g => g.a_nsuid)
    .filter(nsuid => nsuid !== null && nsuid !== undefined);

  const res = await eshop.getPrices(country, nsuids);

  return res.prices.forEach(price => {
    const a_nsuid = price.title_id.toString();
    const match = _find(games, { a_nsuid });
    match.prices[country] = price;
  });
}

const getPricesEurope = async country => {
  const nsuids = _map(games, g => g.e_nsuid)
    .filter(nsuid => nsuid !== null && nsuid !== undefined);

  const res = await eshop.getPrices(country, nsuids);

  return res.prices.forEach(price => {
    const e_nsuid = price.title_id.toString();
    const match = _find(games, { e_nsuid });
    match.prices[country] = price;
  });
};

const sortGames = (sort, order) =>
  (a, b) => {
    const pa = a[sort];
    const pb = b[sort];

    if (sort === 'release_date') {
      if (pa === null) return order * 1;
      else if (pb === null) return order * -1;
      else return order * (pa > pb ? 1 : -1);
    }
    else {
      return order * (pa < pb ? -1 : pa > pb ? 1 : 0);
    }
  };

(async function init() {
  try {
    const [
      gamesAmerica,
      gamesEurope
    ] = await Promise.all([
      eshop.getGamesAmerica(),
      eshop.getGamesEurope()
    ]);

    // Americas
    gamesAmerica.forEach(game => {
      const code = eshop.parseGameCode(game, eshop.Region.AMERICAS);
      if (code !== undefined && code !== null) {
        games[code] = {
          ...games[code],
          id: game.id,
          art: game.front_box_art,
          title: game.title,
          release_date: game.release_date ? new Date(game.release_date) : null,
          a_nsuid: eshop.parseNSUID(game, eshop.Region.AMERICAS),
          prices: {}
        };
      }
    });

    // Europe
    gamesEurope.forEach(async game => {
      const code = eshop.parseGameCode(game, eshop.Region.EUROPE);
      if (code !== undefined && code !== null) {
        if (games[code] === undefined) {
          games[code] = {
            id: game.fs_id,
            art: game.image_url,
            title: game.title,
            release_date: game.release_date ? new Date(game.release_date) : null,
            e_nsuid: eshop.parseNSUID(game, eshop.Region.EUROPE),
            prices: {}
          }
        }
        else {
          games[code].e_nsuid = eshop.parseNSUID(game, eshop.Region.EUROPE);
          if (game.image_url_sq_s !== undefined) {
            games[code].art = game.image_url_sq_s;
          }
          if (games[code].art == undefined) {
            games[code].art = game.image_url;
          }
        }
      }
    });

    promises = [];

    ['US', 'CA'].forEach(c => promises.push(getPricesAmerica(c)));

    ['IE'].forEach(c => promises.push(getPricesEurope(c)));

    await Promise.all(promises);

    console.log('Loaded:', Object.keys(games).length, 'games');

  } catch (err) {
    console.log(err);
    process.exit(1);
  }
})();

app.use(cors());

app.use(compression())

app.set('port', process.env.PORT || 3000);

app.use(paginate.middleware(10, 50));

app.get('/api/games/', (req, res) => {
  const gameList = Object.values(games);
  const pageCount = Math.ceil(gameList.length / req.query.limit);
  const sort = req.query.sort || 'title';
  const filter = req.query.filter
    ? req.query.filter.toString().toLowerCase()
    : '';
  const order = req.query.order === 'asc'
    ? 1
    : req.query.order === 'desc'
      ? -1
      : 1;

  const data = gameList
    .filter(g => g.title.toString().toLowerCase().indexOf(filter) !== -1)
    .sort(sortGames(sort, order))

  const count = data.length;

  res.json({
    has_more: paginate.hasNextPages(req)(pageCount),
    total: gameList.length,
    count: data.length,
    data: data.splice(req.skip, req.query.limit)
  });
});

app.use(opbeat.middleware.express());

app.listen(app.get('port'), () => {
  console.log(`Server running on http://localhost:${app.get('port')}`);
});
