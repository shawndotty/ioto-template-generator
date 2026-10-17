# 选择器固件

这些是 Vault 里**真实使用**的选择器脚本副本，用来锁住 `parseSelector` 的导入行为。
插件是独立的 git 仓库，不能跨目录引用，所以必须复制进来。

来源目录（Vault）：

```
0-辅助/IOTO/Templates/Templater/MyIOTO/选择器模板/
```

刷新方式：五个文件原样覆盖复制（不要改内容）。若上游新增字段，先跑 `npm run test`，
再按新字段补断言。
