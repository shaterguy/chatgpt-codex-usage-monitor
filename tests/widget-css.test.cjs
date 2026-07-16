"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../src/widget.css"), "utf8");

test("접힌 사이드바 위젯을 부모 레이아웃과 무관하게 가로 중앙에 정렬한다", () => {
  const selector = ':host([data-layout="integrated"][data-sidebar="collapsed"])';
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, "접힌 사이드바 호스트 규칙이 있어야 한다");

  const end = css.indexOf("}", start);
  const rule = css.slice(start, end + 1);
  assert.match(rule, /margin-inline:\s*auto\s*;/);
  assert.match(rule, /align-self:\s*center\s*;/);
  assert.match(rule, /justify-self:\s*center\s*;/);
});
