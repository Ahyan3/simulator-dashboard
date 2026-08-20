<?php
/**
 * screenshot.php
 * ---------------------------------------------------------------------------
 * Browsers can't read files from your PC's filesystem directly — that's a
 * security restriction, not a bug. This is the small server-side piece that
 * bridges the gap: it watches the folder your simulator saves screenshots
 * into, and hands the dashboard the newest one over HTTP.
 *
 * THIS IS THE ONLY SETTING YOU SHOULD NEED TO EDIT IN THIS FILE:
 * ---------------------------------------------------------------------------
 */

$screenshotFolder = __DIR__ . '/screenshots';
// Point this at your real folder instead, for example:
//   $screenshotFolder = 'C:/Users/yourname/SimulatorScreenshots';
// (Forward slashes work fine in PHP on Windows and are less error-prone
// than escaping backslashes — either works.)

$allowedExtensions = ['png', 'jpg', 'jpeg', 'bmp', 'gif'];

/**
 * ---------------------------------------------------------------------------
 * Nothing below this line should need editing.
 * ---------------------------------------------------------------------------
 */

header('Content-Type: application/json');
header('Cache-Control: no-store');

/** Find the most recently modified image in $folder with an allowed extension. */
function findLatestScreenshot($folder, $extensions) {
    if (!is_dir($folder)) {
        return null;
    }
    $files = @scandir($folder);
    if ($files === false) {
        return null;
    }
    $latestName = null;
    $latestMtime = -1;
    foreach ($files as $f) {
        if ($f === '.' || $f === '..') continue;
        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        if (!in_array($ext, $extensions, true)) continue;
        $full = $folder . DIRECTORY_SEPARATOR . $f;
        if (!is_file($full)) continue;
        $mtime = @filemtime($full);
        if ($mtime === false) continue;
        if ($mtime > $latestMtime) {
            $latestMtime = $mtime;
            $latestName = $f;
        }
    }
    if ($latestName === null) {
        return null;
    }
    return ['filename' => $latestName, 'mtime' => $latestMtime];
}

$action = isset($_GET['action']) ? $_GET['action'] : 'latest';

if ($action === 'image') {
    // Serve one specific image, defensively:
    //  - filename only (basename() strips any directory component)
    //  - extension must be in the allowlist
    //  - the resolved real path must land inside the configured folder
    //    (blocks ../ path traversal even if someone tries it)
    $requested = basename(isset($_GET['file']) ? $_GET['file'] : '');
    $ext = strtolower(pathinfo($requested, PATHINFO_EXTENSION));

    if ($requested === '' || !in_array($ext, $allowedExtensions, true)) {
        http_response_code(400);
        echo json_encode(['error' => 'invalid filename']);
        exit;
    }

    $full = $screenshotFolder . DIRECTORY_SEPARATOR . $requested;
    $realFull = realpath($full);
    $realFolder = realpath($screenshotFolder);

    if ($realFull === false || $realFolder === false || strpos($realFull, $realFolder) !== 0) {
        http_response_code(403);
        echo json_encode(['error' => 'forbidden']);
        exit;
    }

    $mimeMap = [
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'bmp' => 'image/bmp',
        'gif' => 'image/gif'
    ];
    header('Content-Type: ' . $mimeMap[$ext]);
    header('Content-Length: ' . filesize($realFull));
    readfile($realFull);
    exit;
}

// Default action: report the newest screenshot's name + timestamp as JSON.
// A missing/unreadable folder is a normal, expected state (simulator not
// running yet) — it returns found:false, never an error page or a crash.
$latest = findLatestScreenshot($screenshotFolder, $allowedExtensions);

if ($latest === null) {
    echo json_encode([
        'found' => false,
        'folderExists' => is_dir($screenshotFolder)
    ]);
    exit;
}

echo json_encode([
    'found' => true,
    'filename' => $latest['filename'],
    'timestamp' => date('c', $latest['mtime']),
    'url' => 'screenshot.php?action=image&file=' . urlencode($latest['filename'])
]);
