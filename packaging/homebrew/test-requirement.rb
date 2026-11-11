require "formula"
require "tmpdir"

formula = Formulary.from_path(Pathname.new(ARGV.fetch(0)))
requirement = formula.requirements.find { |item| item.class.name.end_with?("MdviewLinuxToolsRequirement") }
raise "Linux tool requirement missing" unless requirement
raise "This check requires Linux ldd" unless File.executable?("/usr/bin/ldd")

original_path = ENV["PATH"]
begin
  Dir.mktmpdir("mdview-tools-") do |directory|
    %w[bwrap systemd-run].each do |name|
      # These must not run: dependency checks do not establish host capability.
      File.write(File.join(directory, name), "#!/bin/sh\nexit 99\n")
      File.chmod(0755, File.join(directory, name))
    end
    ENV["PATH"] = directory
    raise "Alternate absolute PATH rejected" unless requirement.satisfied?

    File.chmod(0644, File.join(directory, "bwrap"))
    raise "Non-executable Bubblewrap accepted" if requirement.satisfied?
    File.chmod(0755, File.join(directory, "bwrap"))
    File.unlink(File.join(directory, "systemd-run"))
    raise "Missing systemd-run accepted" if requirement.satisfied?
    File.write(File.join(directory, "systemd-run"), "#!/bin/sh\nexit 99\n")
    File.chmod(0755, File.join(directory, "systemd-run"))

    Dir.chdir(directory) do
      ENV["PATH"] = "."
      raise "Relative PATH accepted" if requirement.satisfied?
      ENV["PATH"] = ""
      raise "Empty PATH accepted" if requirement.satisfied?
    end
  end
ensure
  ENV["PATH"] = original_path
end
puts "Linux executable requirement checks passed"
