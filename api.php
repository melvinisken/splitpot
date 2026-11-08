<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

define('SPLITPOT_DATA_DIR', __DIR__ . '/data');
define('SPLITPOT_DATA_FILE', SPLITPOT_DATA_DIR . '/splitpot.json');
define('SPLITPOT_MAX_BODY_BYTES', 1048576);

function splitpot_send_json(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function splitpot_valid_data($d): bool
{
    if (!is_array($d)) {
        return false;
    }
    if (!isset($d['title']) || !is_string($d['title'])) {
        return false;
    }
    if (!isset($d['members']) || !is_array($d['members'])) {
        return false;
    }
    foreach ($d['members'] as $m) {
        if (!is_string($m) || trim($m) === '') {
            return false;
        }
    }
    if (!isset($d['expenses']) || !is_array($d['expenses'])) {
        return false;
    }
    foreach ($d['expenses'] as $x) {
        if (!is_array($x)) {
            return false;
        }
        if (!isset($x['title']) || !is_string($x['title'])) {
            return false;
        }
        if (!isset($x['amount']) || !is_numeric($x['amount']) || !is_finite((float) $x['amount'])) {
            return false;
        }
        if (!isset($x['payer']) || !is_string($x['payer'])) {
            return false;
        }
        if (!isset($x['participants']) || !is_array($x['participants']) || count($x['participants']) === 0) {
            return false;
        }
        foreach ($x['participants'] as $p) {
            if (!is_string($p)) {
                return false;
            }
        }
    }
    if (array_key_exists('payments', $d)) {
        if (!is_array($d['payments'])) {
            return false;
        }
        foreach ($d['payments'] as $p) {
            if (!is_array($p)) {
                return false;
            }
            if (!isset($p['from']) || !is_string($p['from'])) {
                return false;
            }
            if (!isset($p['to']) || !is_string($p['to'])) {
                return false;
            }
            if (!isset($p['amount']) || !is_numeric($p['amount']) || !is_finite((float) $p['amount'])) {
                return false;
            }
        }
    }
    return true;
}

function splitpot_read_data()
{
    if (!is_file(SPLITPOT_DATA_FILE)) {
        return null;
    }
    $raw = @file_get_contents(SPLITPOT_DATA_FILE);
    if ($raw === false) {
        return null;
    }
    $parsed = json_decode($raw, true);
    return splitpot_valid_data($parsed) ? $parsed : null;
}

function splitpot_write_data(array $data): void
{
    if (!is_dir(SPLITPOT_DATA_DIR)) {
        if (!@mkdir(SPLITPOT_DATA_DIR, 0770, true) && !is_dir(SPLITPOT_DATA_DIR)) {
            throw new RuntimeException('Datenverzeichnis nicht anlegbar');
        }
    }
    $htaccess = SPLITPOT_DATA_DIR . '/.htaccess';
    if (!is_file($htaccess)) {
        $rules = "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n";
        @file_put_contents($htaccess, $rules);
    }
    $lock = @fopen(SPLITPOT_DATA_DIR . '/.lock', 'c');
    if ($lock === false) {
        throw new RuntimeException('Sperrdatei nicht oeffnbar');
    }
    if (!flock($lock, LOCK_EX)) {
        fclose($lock);
        throw new RuntimeException('Sperre nicht erhaltbar');
    }
    try {
        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            throw new RuntimeException('JSON-Encoding fehlgeschlagen');
        }
        $tmp = SPLITPOT_DATA_FILE . '.tmp';
        if (@file_put_contents($tmp, $json . "\n") === false) {
            throw new RuntimeException('Temporaere Datei nicht schreibbar');
        }
        if (!@rename($tmp, SPLITPOT_DATA_FILE)) {
            @unlink($tmp);
            throw new RuntimeException('Umbenennen fehlgeschlagen');
        }
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';

if ($method === 'GET') {
    splitpot_send_json(200, array('data' => splitpot_read_data()));
}

if ($method === 'PUT') {
    $body = @file_get_contents('php://input');
    if ($body === false || strlen($body) > SPLITPOT_MAX_BODY_BYTES) {
        splitpot_send_json(413, array('error' => 'Payload zu gross'));
    }
    $parsed = json_decode($body, true);
    if ($parsed === null && json_last_error() !== JSON_ERROR_NONE) {
        splitpot_send_json(400, array('error' => 'Ungueltiges JSON'));
    }
    if (!splitpot_valid_data($parsed)) {
        splitpot_send_json(422, array('error' => 'Daten entsprechen nicht dem erwarteten Format'));
    }
    try {
        splitpot_write_data($parsed);
    } catch (RuntimeException $e) {
        splitpot_send_json(500, array('error' => 'Speichern fehlgeschlagen'));
    }
    http_response_code(204);
    exit;
}

splitpot_send_json(405, array('error' => 'Methode nicht erlaubt'));
