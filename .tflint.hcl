# tflint for every module under deploy/terraform (CI runs it per module with --chdir).
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
