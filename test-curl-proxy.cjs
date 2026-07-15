const { execFile, spawn } = require('child_process');

function fetchHeaders(url, range) {
  return new Promise((resolve, reject) => {
    const args = ["-sI", url];
    if (range) args.push("-H", `Range: ${range}`);
    execFile("curl", args, (error, stdout) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
}

const url = process.argv[2];
fetchHeaders(url, "bytes=0-100").then(console.log);
