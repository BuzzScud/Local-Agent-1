-- Bonsai Code launcher (like XMR Miner.app): opens Terminal and runs bonsai in a
-- project folder. Double-click: pick the folder (starts at the last one used).
-- Drop a folder (or a file in it) on the icon: opens that folder.
-- Built by app/make-app.sh.

on run
	if not installed() then return
	set startAt to lastFolder()
	try
		if startAt is missing value then
			set f to choose folder with prompt "Open Bonsai Code in which project folder?"
		else
			set f to choose folder with prompt "Open Bonsai Code in which project folder?" default location startAt
		end if
	on error number -128
		return -- cancelled
	end try
	launchIn(POSIX path of f)
end run

on open droppedItems
	if not installed() then return
	set p to POSIX path of (item 1 of droppedItems)
	if p does not end with "/" then set p to do shell script "dirname " & quoted form of p
	launchIn(p)
end open

on launchIn(p)
	do shell script "mkdir -p \"$HOME/.bonsai-code\" && printf %s " & quoted form of p & " > \"$HOME/.bonsai-code/last-folder\""
	tell application "Terminal"
		activate
		do script "cd " & quoted form of p & " && clear && exec \"$HOME/.local/bin/bonsai\""
		try
			set number of columns of front window to 150
			set number of rows of front window to 55
		end try
	end tell
end launchIn

on lastFolder()
	try
		set p to do shell script "cat \"$HOME/.bonsai-code/last-folder\""
		if p is "" then return missing value
		return (POSIX file p) as alias
	on error
		return missing value
	end try
end lastFolder

on installed()
	try
		do shell script "test -x \"$HOME/.local/bin/bonsai\""
		return true
	on error
		display dialog "The bonsai command isn't installed yet." & return & return & "In Terminal, run:" & return & "cd ~/Desktop/bonsai-code && bun run install-cli" buttons {"OK"} default button 1 with title "Bonsai Code" with icon caution
		return false
	end try
end installed
