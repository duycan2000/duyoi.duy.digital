<?php
// Kiểm thử phần thuần của plugin: php wordpress/tests/test.php
define('DUYOI_TEST', true);
require __DIR__ . '/../duyoi-connector/duyoi-connector.php';
$fail = 0;
function ok($cond, $msg) { global $fail; if ($cond) { echo "  ✓ $msg\n"; } else { echo "  ✗ $msg\n"; $fail++; } }

echo "Duy Ơi Connector · PHP tests\n";
$html = "<p>Erster Satz. Zweiter Satz über TGA.</p>\n<p>Anderer Absatz.</p>";
$r = duyoi_apply_edit($html, ['find' => 'Zweiter Satz über TGA.', 'replace' => 'Zweiter Satz über TGA. Mehr dazu: <a href="/tga/">TGA</a>.']);
ok($r === "<p>Erster Satz. Zweiter Satz über TGA. Mehr dazu: <a href=\"/tga/\">TGA</a>.</p>\n<p>Anderer Absatz.</p>", 'replace giữ nguyên câu gốc, chỉ thêm link');
ok(duyoi_apply_edit($html, ['find' => 'Satz', 'replace' => 'Satz X']) === null, 'từ chối khi khớp nhiều lần');
ok(duyoi_apply_edit($html, ['find' => 'Không có', 'replace' => 'Không có X']) === null, 'từ chối khi không khớp');
ok(duyoi_apply_edit($html, ['find' => 'Anderer Absatz.', 'replace' => 'Ganz neu.']) === null, 'từ chối khi replace làm mất chữ gốc');
$r = duyoi_apply_edit($html, ['find' => 'Erster Satz.', 'mode' => 'after_block', 'insert' => '<p>Neu.</p>']);
ok($r === "<p>Erster Satz. Zweiter Satz über TGA.</p><p>Neu.</p>\n<p>Anderer Absatz.</p>", 'chèn sau khối </p>');
$r = duyoi_apply_edit($html, ['find' => 'Anderer Absatz.', 'mode' => 'before_block', 'insert' => '<p>Antwort.</p>']);
ok($r === "<p>Erster Satz. Zweiter Satz über TGA.</p>\n<p>Antwort.</p><p>Anderer Absatz.</p>", 'chèn trước khối chứa câu');
$gb = "<!-- wp:paragraph -->\n<p>Eins.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Zwei.</p>\n<!-- /wp:paragraph -->";
$r = duyoi_apply_edit($gb, ['find' => 'Eins.', 'mode' => 'after_block', 'insert' => '<p>FAQ</p>']);
ok(strpos($r, "<!-- /wp:paragraph -->\n<!-- wp:html -->\n<p>FAQ</p>\n<!-- /wp:html -->") !== false, 'Gutenberg: chèn thành block wp:html sau block');
$r = duyoi_apply_edit($gb, ['find' => 'Zwei.', 'mode' => 'before_block', 'insert' => '<p>A</p>']);
ok(strpos($r, "<!-- wp:html -->\n<p>A</p>\n<!-- /wp:html -->\n<!-- wp:paragraph -->\n<p>Zwei.</p>") !== false, 'Gutenberg: chèn trước block');
$el = [['id' => 'a', 'elType' => 'section', 'settings' => [], 'elements' => [
  ['id' => 'b', 'elType' => 'widget', 'widgetType' => 'heading', 'settings' => ['title' => 'Gewinde und Bohrungen'], 'elements' => []],
  ['id' => 'c', 'elType' => 'widget', 'widgetType' => 'text-editor', 'settings' => ['editor' => '<p>Satz eins. Die Symbole erzeugen Darstellungen.</p>'], 'elements' => []]
]]];
$res = duyoi_apply_all($el, [['find' => 'Die Symbole erzeugen Darstellungen.', 'replace' => 'Die Symbole erzeugen Darstellungen. Unsere <a href="/tga/">TGA-CAD-Experten</a> helfen.']], true);
ok($res['ok'] && $res['content'][0]['elements'][1]['settings']['editor'] === '<p>Satz eins. Die Symbole erzeugen Darstellungen. Unsere <a href="/tga/">TGA-CAD-Experten</a> helfen.</p>', 'Elementor: sửa đúng widget, giữ nguyên phần còn lại');
ok($res['content'][0]['elements'][0]['settings']['title'] === 'Gewinde und Bohrungen', 'Elementor: widget khác không đổi');
$res = duyoi_apply_all($el, [['find' => 'e', 'replace' => 'e X']], true);
ok(!$res['ok'] && strpos($res['error'], 'Elementor') !== false, 'Elementor: từ chối khi đoạn gốc không khớp đúng 1 lần');
$el2 = $el; $el2[0]['elements'][] = ['id' => 'd', 'elType' => 'widget', 'settings' => ['editor' => 'Die Symbole erzeugen Darstellungen.'], 'elements' => []];
ok(!duyoi_apply_all($el2, [['find' => 'Die Symbole erzeugen Darstellungen.', 'replace' => 'Die Symbole erzeugen Darstellungen. X']], true)['ok'], 'Elementor: khớp ở 2 widget thì từ chối');
$multi = duyoi_apply_all($html, [['find' => 'Erster Satz.', 'replace' => 'Erster Satz. A.'], ['find' => 'Anderer Absatz.', 'replace' => 'Anderer Absatz. B.']], false);
ok($multi['ok'] && $multi['changes'] === 2, 'nhiều sửa trên cùng bài');
echo $fail ? "\n$fail test lỗi.\n" : "\nTất cả test PHP đạt.\n";
exit($fail ? 1 : 0);
