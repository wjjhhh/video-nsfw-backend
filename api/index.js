module.exports = (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Serverless Function is working' });
};
