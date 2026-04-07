#!/bin/bash
systemctl restart gold-bolt-server
systemctl status gold-bolt-server --no-pager
