const app = require('../dist/index.js').default;

module.exports = (req, res) => {
  app(req, res);
};
