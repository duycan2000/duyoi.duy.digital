<?php
/**
 * Plugin Name: Duy Ơi Connector
 * Description: Cho app Duy Ơi đọc và sửa "phẫu thuật" nội dung SEO (post_content, Elementor, Rank Math) qua REST API, có kiểm tra khớp đúng 1 chỗ, xoá cache và khôi phục.
 * Version: 1.0.0
 * Requires PHP: 7.4
 * Author: Duy Ơi
 * License: GPLv2 or later
 *
 * Bảo mật: mọi endpoint yêu cầu đăng nhập bằng Application Password của user có quyền sửa bài.
 * Plugin không tự sửa gì: chỉ làm đúng lệnh app gửi, và từ chối nếu đoạn cần sửa không khớp đúng 1 lần.
 */

if (!defined('ABSPATH') && !defined('DUYOI_TEST')) {
    exit;
}

const DUYOI_VERSION = '1.0.0';
const DUYOI_META_KEYS = ['rank_math_title', 'rank_math_description', 'rank_math_focus_keyword'];

// ---------------------------------------------------------------------------
// Phần thuần (không gọi WordPress) — có test riêng
// ---------------------------------------------------------------------------

/** Đếm số lần $needle xuất hiện trong $hay. */
function duyoi_count($hay, $needle)
{
    if ($needle === '' || !is_string($hay)) {
        return 0;
    }
    return substr_count($hay, $needle);
}

/** Vị trí chèn sau phần tử khối chứa vị trí $end (</p>, </h2>…), kể cả comment kết thúc block Gutenberg ngay sau. */
function duyoi_block_end($s, $end)
{
    if (!preg_match('#</(p|h[1-6]|ul|ol|li|blockquote|table|figure|div)>#i', $s, $m, PREG_OFFSET_CAPTURE, $end)) {
        return strlen($s);
    }
    $pos = $m[0][1] + strlen($m[0][0]);
    if (preg_match('#\G\s*<!-- /wp:[a-z0-9/-]+ -->#i', $s, $m2, 0, $pos)) {
        $pos += strlen($m2[0]);
    }
    return $pos;
}

/** Vị trí bắt đầu của phần tử khối chứa vị trí $start, kể cả comment mở block Gutenberg ngay trước. */
function duyoi_block_start($s, $start)
{
    $head = substr($s, 0, $start);
    if (!preg_match_all('#<(p|h[1-6]|ul|ol|li|blockquote|table|figure)\b[^>]*>#i', $head, $m, PREG_OFFSET_CAPTURE)) {
        return 0;
    }
    $last = end($m[0]);
    $pos = $last[1];
    $before = substr($s, 0, $pos);
    if (preg_match('#<!-- wp:[a-z0-9/-]+(?:\s+\{.*?\})?\s*-->\s*$#is', $before, $m2, PREG_OFFSET_CAPTURE)) {
        $pos = $m2[0][1];
    }
    return $pos;
}

/** Bọc HTML chèn thêm thành block Gutenberg nếu nội dung đang dùng block. */
function duyoi_wrap_block($s, $html)
{
    return strpos($s, '<!-- wp:') !== false ? "\n<!-- wp:html -->\n" . $html . "\n<!-- /wp:html -->\n" : $html;
}

/**
 * Áp một lệnh sửa vào chuỗi. Trả về chuỗi mới, hoặc null nếu không khớp đúng 1 lần.
 * mode: replace (thay find bằng replace, replace phải chứa nguyên find) | after_block | before_block (chèn insert).
 */
function duyoi_apply_edit($s, array $e)
{
    $find = isset($e['find']) ? (string) $e['find'] : '';
    if ($find === '' || duyoi_count($s, $find) !== 1) {
        return null;
    }
    $mode = isset($e['mode']) ? $e['mode'] : 'replace';
    $at = strpos($s, $find);
    if ($mode === 'replace') {
        $replace = isset($e['replace']) ? (string) $e['replace'] : '';
        if (strpos($replace, $find) === false) {
            return null; // không được làm mất chữ gốc
        }
        return substr($s, 0, $at) . $replace . substr($s, $at + strlen($find));
    }
    $insert = isset($e['insert']) ? (string) $e['insert'] : '';
    if ($insert === '') {
        return null;
    }
    if ($mode === 'after_block') {
        $pos = duyoi_block_end($s, $at + strlen($find));
        return substr($s, 0, $pos) . duyoi_wrap_block($s, $insert) . substr($s, $pos);
    }
    if ($mode === 'before_block') {
        $pos = duyoi_block_start($s, $at);
        return substr($s, 0, $pos) . duyoi_wrap_block($s, $insert) . substr($s, $pos);
    }
    return null;
}

/** Duyệt mọi chuỗi trong cây Elementor (chỉ trong "settings" của widget). */
function duyoi_el_walk(array &$nodes, callable $fn)
{
    foreach ($nodes as &$n) {
        if (!is_array($n)) {
            continue;
        }
        if (isset($n['settings']) && is_array($n['settings'])) {
            foreach ($n['settings'] as $k => &$v) {
                if (is_string($v)) {
                    $fn($v, $n, $k);
                }
            }
            unset($v);
        }
        if (isset($n['elements']) && is_array($n['elements'])) {
            duyoi_el_walk($n['elements'], $fn);
        }
    }
    unset($n);
}

/**
 * Áp danh sách sửa vào nội dung (chuỗi post_content hoặc mảng Elementor).
 * Trả về ['ok'=>bool, 'content'=>..., 'changes'=>n, 'error'=>string]
 */
function duyoi_apply_all($content, array $edits, $is_elementor)
{
    $changes = 0;
    foreach ($edits as $i => $e) {
        $n = $i + 1;
        $find = isset($e['find']) ? (string) $e['find'] : '';
        if ($is_elementor) {
            $total = 0;
            duyoi_el_walk($content, function (&$v) use ($find, &$total) {
                $total += duyoi_count($v, $find);
            });
            if ($total !== 1) {
                return ['ok' => false, 'changes' => 0, 'error' => "Sửa #$n: đoạn gốc khớp $total lần trong dữ liệu Elementor (phải đúng 1)."];
            }
            $done = false;
            duyoi_el_walk($content, function (&$v) use ($e, &$done) {
                if (!$done && duyoi_count($v, $e['find']) === 1) {
                    $new = duyoi_apply_edit($v, $e);
                    if ($new !== null) {
                        $v = $new;
                        $done = true;
                    }
                }
            });
            if (!$done) {
                return ['ok' => false, 'changes' => 0, 'error' => "Sửa #$n không áp dụng được (replace phải chứa nguyên đoạn gốc)."];
            }
        } else {
            $count = duyoi_count($content, $find);
            if ($count !== 1) {
                return ['ok' => false, 'changes' => 0, 'error' => "Sửa #$n: đoạn gốc khớp $count lần trong nội dung (phải đúng 1)."];
            }
            $new = duyoi_apply_edit($content, $e);
            if ($new === null) {
                return ['ok' => false, 'changes' => 0, 'error' => "Sửa #$n không áp dụng được (replace phải chứa nguyên đoạn gốc)."];
            }
            $content = $new;
        }
        $changes++;
    }
    return ['ok' => true, 'content' => $content, 'changes' => $changes, 'error' => ''];
}

// ---------------------------------------------------------------------------
// Phần WordPress
// ---------------------------------------------------------------------------

if (defined('DUYOI_TEST')) {
    return;
}

function duyoi_find_post_id($url)
{
    $id = url_to_postid($url);
    if (!$id) {
        $path = trim((string) wp_parse_url($url, PHP_URL_PATH), '/');
        if ($path !== '') {
            $p = get_page_by_path($path, OBJECT, ['page', 'post']);
            if (!$p) {
                $p = get_page_by_path(basename($path), OBJECT, ['post', 'page']);
            }
            $id = $p ? $p->ID : 0;
        } else {
            $id = (int) get_option('page_on_front');
        }
    }
    return (int) $id;
}

function duyoi_is_elementor($id)
{
    return get_post_meta($id, '_elementor_edit_mode', true) === 'builder' && get_post_meta($id, '_elementor_data', true) !== '';
}

function duyoi_snapshot($id)
{
    $p = get_post($id);
    $meta = [];
    foreach (DUYOI_META_KEYS as $k) {
        $meta[$k] = get_post_meta($id, $k, true);
    }
    $meta['rank_math_canonical_url'] = get_post_meta($id, 'rank_math_canonical_url', true);
    $meta['rank_math_robots'] = get_post_meta($id, 'rank_math_robots', true);
    $el = duyoi_is_elementor($id);
    return [
        'id' => $id,
        'type' => $p->post_type,
        'status' => $p->post_status,
        'slug' => $p->post_name,
        'link' => get_permalink($id),
        'modified_gmt' => $p->post_modified_gmt,
        'content' => $p->post_content,
        'elementor' => $el,
        'elementor_data' => $el ? get_post_meta($id, '_elementor_data', true) : null,
        'meta' => $meta,
    ];
}

/** Xoá cache để thay đổi hiện ra ngay. Trả về tên các cache đã xoá. */
function duyoi_purge($id, $elementor_changed)
{
    $done = [];
    $url = get_permalink($id);
    clean_post_cache($id);
    if ($elementor_changed && class_exists('\Elementor\Plugin')) {
        try {
            \Elementor\Plugin::$instance->files_manager->clear_cache();
            $done[] = 'elementor-css';
        } catch (\Throwable $t) { /* bỏ qua */ }
    }
    if (class_exists('\FlyingPress\Purge')) {
        if (method_exists('\FlyingPress\Purge', 'purge_url')) {
            \FlyingPress\Purge::purge_url($url);
            $done[] = 'flyingpress';
        } elseif (method_exists('\FlyingPress\Purge', 'purge_pages')) {
            \FlyingPress\Purge::purge_pages();
            $done[] = 'flyingpress';
        }
    }
    if (function_exists('rocket_clean_post')) {
        rocket_clean_post($id);
        $done[] = 'wp-rocket';
    }
    if (has_action('litespeed_purge_post')) {
        do_action('litespeed_purge_post', $id);
        $done[] = 'litespeed';
    }
    if (function_exists('w3tc_flush_post')) {
        w3tc_flush_post($id);
        $done[] = 'w3tc';
    }
    do_action('duyoi_after_edit', $id);
    return $done;
}

function duyoi_can_edit_from_request(WP_REST_Request $r)
{
    $id = (int) $r->get_param('id');
    return $id ? current_user_can('edit_post', $id) : current_user_can('edit_posts');
}

add_action('rest_api_init', function () {
    register_rest_route('duyoi/v1', '/ping', [
        'methods' => 'GET',
        'permission_callback' => function () { return current_user_can('edit_posts'); },
        'callback' => function () {
            $u = wp_get_current_user();
            return [
                'ok' => true,
                'version' => DUYOI_VERSION,
                'wp' => get_bloginfo('version'),
                'user' => $u->user_login,
                'elementor' => defined('ELEMENTOR_VERSION'),
                'rankmath' => class_exists('RankMath'),
                'flyingpress' => class_exists('\FlyingPress\Purge'),
            ];
        },
    ]);

    register_rest_route('duyoi/v1', '/post', [
        'methods' => 'GET',
        'permission_callback' => function () { return current_user_can('edit_posts'); },
        'callback' => function (WP_REST_Request $r) {
            $id = (int) $r->get_param('id');
            if (!$id) {
                $id = duyoi_find_post_id((string) $r->get_param('url'));
            }
            if (!$id || !get_post($id)) {
                return new WP_Error('not_found', 'Không tìm thấy bài viết cho URL này.', ['status' => 404]);
            }
            if (!current_user_can('edit_post', $id)) {
                return new WP_Error('forbidden', 'User không có quyền sửa bài này.', ['status' => 403]);
            }
            return duyoi_snapshot($id);
        },
    ]);

    register_rest_route('duyoi/v1', '/apply', [
        'methods' => 'POST',
        'permission_callback' => 'duyoi_can_edit_from_request',
        'callback' => function (WP_REST_Request $r) {
            $id = (int) $r->get_param('id');
            $p = get_post($id);
            if (!$p) {
                return new WP_Error('not_found', 'Không tìm thấy bài.', ['status' => 404]);
            }
            $expected = (string) $r->get_param('expected_modified');
            if ($expected !== '' && $expected !== $p->post_modified_gmt) {
                return new WP_Error('conflict', 'Bài vừa được sửa ở nơi khác sau khi app đọc. Quét lại rồi thử lại.', ['status' => 409]);
            }
            $edits = (array) $r->get_param('edits');
            $meta = (array) $r->get_param('meta');
            $dry = (bool) $r->get_param('dry_run');
            $el = duyoi_is_elementor($id);
            $changes = 0;
            $new_content = null;
            if ($edits) {
                if ($el) {
                    $data = json_decode(get_post_meta($id, '_elementor_data', true), true);
                    if (!is_array($data)) {
                        return new WP_Error('elementor', 'Không đọc được dữ liệu Elementor.', ['status' => 422]);
                    }
                    $res = duyoi_apply_all($data, $edits, true);
                } else {
                    $res = duyoi_apply_all($p->post_content, $edits, false);
                }
                if (!$res['ok']) {
                    return new WP_Error('no_match', $res['error'], ['status' => 422]);
                }
                $changes = $res['changes'];
                $new_content = $res['content'];
            }
            $meta_ok = [];
            foreach ($meta as $k => $v) {
                if (!in_array($k, DUYOI_META_KEYS, true)) {
                    return new WP_Error('meta', "Không được sửa $k qua app (việc khó đảo ngược).", ['status' => 422]);
                }
                $meta_ok[$k] = sanitize_text_field((string) $v);
            }
            if ($dry) {
                return ['ok' => true, 'dry_run' => true, 'changes' => $changes, 'meta' => array_keys($meta_ok), 'elementor' => $el];
            }
            if ($new_content !== null) {
                if ($el) {
                    update_post_meta($id, '_elementor_data', wp_slash(wp_json_encode($new_content)));
                    wp_update_post(['ID' => $id]); // tạo revision và cập nhật ngày sửa
                } else {
                    $ok = wp_update_post(['ID' => $id, 'post_content' => wp_slash($new_content)], true);
                    if (is_wp_error($ok)) {
                        return $ok;
                    }
                }
            }
            foreach ($meta_ok as $k => $v) {
                update_post_meta($id, $k, $v);
            }
            $purged = duyoi_purge($id, $el && $new_content !== null);
            clean_post_cache($id);
            return ['ok' => true, 'changes' => $changes, 'meta' => array_keys($meta_ok), 'elementor' => $el, 'purged' => $purged, 'modified_gmt' => get_post($id)->post_modified_gmt];
        },
    ]);

    register_rest_route('duyoi/v1', '/restore', [
        'methods' => 'POST',
        'permission_callback' => 'duyoi_can_edit_from_request',
        'callback' => function (WP_REST_Request $r) {
            $id = (int) $r->get_param('id');
            if (!get_post($id)) {
                return new WP_Error('not_found', 'Không tìm thấy bài.', ['status' => 404]);
            }
            $content = $r->get_param('content');
            $el_data = $r->get_param('elementor_data');
            $meta = (array) $r->get_param('meta');
            $el = false;
            if (is_string($el_data) && $el_data !== '') {
                update_post_meta($id, '_elementor_data', wp_slash($el_data));
                $el = true;
            }
            if (is_string($content)) {
                wp_update_post(['ID' => $id, 'post_content' => wp_slash($content)]);
            } elseif ($el) {
                wp_update_post(['ID' => $id]);
            }
            foreach ($meta as $k => $v) {
                if (in_array($k, DUYOI_META_KEYS, true)) {
                    update_post_meta($id, $k, (string) $v);
                }
            }
            $purged = duyoi_purge($id, $el);
            return ['ok' => true, 'purged' => $purged, 'modified_gmt' => get_post($id)->post_modified_gmt];
        },
    ]);
});
