const url = process.argv[2];
fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' } })
  .then(res => console.log(res.status, res.headers.get('content-type')))
  .catch(console.error);
