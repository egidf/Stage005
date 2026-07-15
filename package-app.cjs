const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function runPackaging() {
  console.log('====================================================');
  console.log('             STAGECUE PACKAGING ENGINE              ');
  console.log('====================================================');

  try {
    // 1. Build the production React frontend and bundle the Express server
    console.log('\n[1/5] Compiling production frontend and backend bundle...');
    execSync('npm run build', { stdio: 'inherit' });

    // 2. Run pkg to generate standalone binaries
    console.log('\n[2/5] Compiling standalone executables for Windows and Linux...');
    // We target Node 18 since the pkg binaries for Node 18 are stable and pre-cached
    execSync('pkg dist/server.cjs --targets node18-linux-x64,node18-win-x64 --out-path bin', { stdio: 'inherit' });

    // 3. Rename Windows file to StageCue.exe for premium desktop feel
    console.log('\n[3/5] Polishing Windows executable...');
    const srcWin = path.join(__dirname, 'bin', 'server-win.exe');
    const destWin = path.join(__dirname, 'bin', 'StageCue.exe');

    if (fs.existsSync(srcWin)) {
      if (fs.existsSync(destWin)) {
        fs.unlinkSync(destWin);
      }
      fs.renameSync(srcWin, destWin);
      console.log('✓ Renamed bin/server-win.exe ➔ bin/StageCue.exe');
    } else {
      console.warn('⚠ Windows binary not found at ' + srcWin);
    }

    // 4. Build Debian package (.deb) for Ubuntu/Linux Mint/Debian
    console.log('\n[4/5] Constructing Debian Package (.deb)...');
    const pkgDir = path.join(__dirname, 'stagecue-deb');
    const debianDir = path.join(pkgDir, 'DEBIAN');
    const binDir = path.join(pkgDir, 'usr', 'bin');
    const appDir = path.join(pkgDir, 'usr', 'share', 'applications');

    // Clean up old temporary folders
    if (fs.existsSync(pkgDir)) {
      fs.rmSync(pkgDir, { recursive: true, force: true });
    }

    // Create directories
    fs.mkdirSync(debianDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(appDir, { recursive: true });

    // Copy Linux binary and make it executable (chmod 755)
    const srcLinux = path.join(__dirname, 'bin', 'server-linux');
    const destLinux = path.join(binDir, 'stagecue');

    if (fs.existsSync(srcLinux)) {
      fs.copyFileSync(srcLinux, destLinux);
      fs.chmodSync(destLinux, '755');
      console.log('✓ Placed StageCue engine into standard Linux path structure');
    } else {
      throw new Error('Linux binary not found at ' + srcLinux);
    }

    // Create DEBIAN/control metadata file
    const controlContent = `Package: stagecue
Version: 1.0.0
Section: utils
Priority: optional
Architecture: amd64
Maintainer: StageCue Developer <egimalgina@gmail.com>
Description: StageCue high-fidelity playback engine and automated agenda player.
 Double-click StageCue in your application menu to start.
 It will launch the background player and automatically open the interactive remote dashboard in your browser.
`;
    fs.writeFileSync(path.join(debianDir, 'control'), controlContent.trim() + '\n');

    // Create the Desktop Entry so it shows in Ubuntu's app drawer
    const desktopContent = `[Desktop Entry]
Name=StageCue
Comment=High-fidelity performance playback and agenda player
Exec=/usr/bin/stagecue
Icon=multimedia-audio-player
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Player;
StartupNotify=true
`;
    fs.writeFileSync(path.join(appDir, 'stagecue.desktop'), desktopContent.trim() + '\n');

    // Run dpkg-deb to package it up
    console.log('Building actual debian installer using system packager...');
    const outDeb = path.join(__dirname, 'bin', 'stagecue.deb');
    if (fs.existsSync(outDeb)) {
      fs.unlinkSync(outDeb);
    }

    try {
      execSync(`dpkg-deb --build ${pkgDir} bin/stagecue.deb`, { stdio: 'inherit' });
      console.log('✓ Successfully created bin/stagecue.deb installer!');
    } catch (debErr) {
      console.warn('⚠ dpkg-deb failed or is not installed. Generating .tar.gz fallback.');
      execSync(`tar -czf bin/stagecue.tar.gz -C ${pkgDir} .`, { stdio: 'inherit' });
      console.log('✓ Successfully created fallback archive bin/stagecue.tar.gz');
    }

    // Clean up temporary files
    fs.rmSync(pkgDir, { recursive: true, force: true });

    // 5. Success Overview
    console.log('\n[5/5] Packaging finalized successfully!');
    console.log('====================================================');
    console.log('🎉 STAGECUE DISTRIBUTIONS ARE READY FOR YOUR FRIENDS:');
    console.log('====================================================');
    console.log('1. FOR WINDOWS USERS (Double-click, No Command Line):');
    console.log('   📂 File: bin/StageCue.exe');
    console.log('   👉 Guide: Simply send them "StageCue.exe". They just');
    console.log('             double-click it! It will launch the server');
    console.log('             and instantly pop open their browser to the app.');
    console.log('   No terminals, no PowerShell, no typing required!');
    console.log('----------------------------------------------------');
    console.log('2. FOR UBUNTU/DEBIAN USERS (App Drawer Integrated):');
    console.log('   📂 File: bin/stagecue.deb');
    console.log('   👉 Guide: They just double-click "stagecue.deb" to install');
    console.log('             it like any native app. Once installed, it');
    console.log('             will show up in their Application Drawer.');
    console.log('             Clicking it launches the server & pops open browser!');
    console.log('====================================================\n');

  } catch (error) {
    console.error('Packaging failed:', error);
    process.exit(1);
  }
}

runPackaging();
