package scanner

import (
	"strings"

	"github.com/Spillers-Technology/netviz/internal/oui"
)

var vendorPrefixes = map[string]string{
	"00:1a:11": "Google",
	"00:1b:63": "Apple",
	"00:1c:b3": "Apple",
	"00:21:e9": "Apple",
	"00:23:12": "Apple",
	"00:25:00": "Apple",
	"00:26:bb": "Apple",
	"00:50:56": "VMware",
	"00:80:77": "Brother",
	"00:90:a9": "Western Digital",
	"00:9a:cd": "Hewlett Packard",
	"00:a0:de": "Yamaha",
	"00:e0:4c": "Realtek",
	"04:18:d6": "Ubiquiti",
	"04:d9:f5": "Apple",
	"08:00:27": "VirtualBox",
	"08:11:96": "Intel",
	"0c:4d:e9": "Apple",
	"10:dd:b1": "Apple",
	"14:7d:da": "Apple",
	"18:65:90": "Apple",
	"18:e8:29": "Ubiquiti",
	"20:aa:4b": "Cisco",
	"24:5e:be": "QNAP",
	"24:a4:3c": "Ubiquiti",
	"28:cf:e9": "Apple",
	"2c:54:91": "Microsoft",
	"30:5a:3a": "ASUSTek",
	"34:08:04": "D-Link",
	"38:f9:d3": "Apple",
	"3c:07:54": "Apple",
	"40:cb:c0": "Apple",
	"44:65:0d": "Amazon",
	"44:d9:e7": "Ubiquiti",
	"48:5f:99": "Cloud Network Technology",
	"50:c7:bf": "TP-Link",
	"58:55:ca": "Apple",
	"5c:cf:7f": "Espressif",
	"60:38:e0": "Belkin",
	"64:16:66": "Nest",
	"68:5b:35": "Apple",
	"70:4f:57": "TP-Link",
	"74:83:c2": "Ubiquiti",
	"78:8a:20": "Ubiquiti",
	"80:2a:a8": "Ubiquiti",
	"84:38:35": "Apple",
	"84:d8:1b": "TP-Link",
	"88:1f:a1": "Apple",
	"90:27:e4": "Apple",
	"94:9f:3e": "Sonos",
	"98:01:a7": "Apple",
	"9c:8e:cd": "Amcrest",
	"a4:5e:60": "Apple",
	"a8:5e:45": "Apple",
	"ac:bc:32": "Apple",
	"b0:be:83": "Apple",
	"b8:27:eb": "Raspberry Pi",
	"bc:32:5f": "Zyxel",
	"c0:56:27": "Belkin",
	"c4:2c:03": "Apple",
	"c8:69:cd": "Apple",
	"d0:03:4b": "Apple",
	"d8:3a:dd": "Raspberry Pi",
	"dc:a6:32": "Raspberry Pi",
	"e0:63:da": "Ubiquiti",
	"e4:5f:01": "Raspberry Pi",
	"e8:06:88": "Apple",
	"ec:71:db": "Ubiquiti",
	"f0:18:98": "Apple",
	"f4:5c:89": "Apple",
	"f4:92:bf": "Ubiquiti",
}

// VendorForMAC resolves a MAC to a vendor name. The curated map wins because
// its names are short and display-friendly; everything else falls back to the
// embedded IEEE OUI registry.
func VendorForMAC(mac string) string {
	mac = NormalizeMAC(mac)
	if len(mac) < 8 {
		return ""
	}
	if vendor, ok := vendorPrefixes[strings.ToLower(mac[:8])]; ok {
		return vendor
	}
	return oui.Lookup(mac)
}
