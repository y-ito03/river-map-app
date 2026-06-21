// フォルダ内のGPS CSVをまとめて、班ごとの移動軌跡としてSQLiteに反映する。
// CSVファイル名から班名を判定する。例: D組E班_gps.csv -> D組E班
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function usage() {
    console.log(`
Usage:
  node update_gps_tracks_batch.js <gps-csv-folder> [--dry-run] [--keep-outliers]

File name examples:
  D組E班_gps.csv
  H組F班_gps.csv
  L組G班_gps.csv

Examples:
  node update_gps_tracks_batch.js "C:\\Users\\abono\\Downloads\\gps_csv" --dry-run
  node update_gps_tracks_batch.js "C:\\Users\\abono\\Downloads\\gps_csv"
`);
}

function selectorFromCsvPath(filePath) {
    const baseName = path.basename(filePath, path.extname(filePath));
    return baseName
        .replace(/[_\-\s]*(gps|GPS|track|TRACK)$/i, '')
        .trim();
}

function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const keepOutliers = args.includes('--keep-outliers');
    const positional = args.filter(arg => !arg.startsWith('--'));

    if (positional.length < 1 || args.includes('--help')) {
        usage();
        process.exit(positional.length < 1 ? 1 : 0);
    }

    const folder = path.resolve(positional[0]);
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        console.error(`GPS CSVフォルダが見つかりません: ${folder}`);
        process.exit(1);
    }

    const files = fs.readdirSync(folder)
        .filter(file => file.toLowerCase().endsWith('.csv'))
        .map(file => path.join(folder, file))
        .sort((a, b) => a.localeCompare(b, 'ja'));

    if (files.length === 0) {
        console.error(`CSVファイルが見つかりません: ${folder}`);
        process.exit(1);
    }

    const failed = [];
    const updateScript = path.join(__dirname, 'update_gps_track.js');

    console.log(`GPS CSV folder: ${folder}`);
    console.log(`CSV files: ${files.length}`);
    console.log(dryRun ? 'Mode: dry-run' : 'Mode: update database');

    for (const filePath of files) {
        const selector = selectorFromCsvPath(filePath);
        if (!selector) {
            failed.push(`${path.basename(filePath)}: ファイル名から班名を判定できません`);
            continue;
        }

        console.log('\n----------------------------------------');
        console.log(`${path.basename(filePath)} -> ${selector}`);

        const childArgs = [updateScript, selector, filePath];
        if (dryRun) childArgs.push('--dry-run');
        if (keepOutliers) childArgs.push('--keep-outliers');

        const result = spawnSync(process.execPath, childArgs, {
            stdio: 'inherit',
            cwd: __dirname
        });

        if (result.status !== 0) {
            failed.push(`${path.basename(filePath)}: exit code ${result.status}`);
        }
    }

    console.log('\n========================================');
    if (failed.length > 0) {
        console.error(`Failed: ${failed.length}`);
        failed.forEach(item => console.error(`- ${item}`));
        process.exit(1);
    }

    console.log(`Done: ${files.length} files`);
}

main();
