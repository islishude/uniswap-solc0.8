#!/bin/bash

source .env

forge script script/foundry/Counter.s.sol:CounterScript --rpc-url $LOCAL_RPC_URL --broadcast -vvvv