pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SecureClipboard is ZamaEthereumConfig {
    struct ClipboardItem {
        euint32 encryptedContent;      
        uint256 timestamp;             
        address creator;               
        uint32 decryptedContent;       
        bool isVerified;               
        string keyword;                
    }

    mapping(string => ClipboardItem) public clipboardData;
    string[] public itemIds;

    event ItemCreated(string indexed itemId, address indexed creator);
    event DecryptionVerified(string indexed itemId, uint32 decryptedContent);

    constructor() ZamaEthereumConfig() {
    }

    function createClipboardItem(
        string calldata itemId,
        externalEuint32 encryptedContent,
        bytes calldata inputProof,
        string calldata keyword
    ) external {
        require(bytes(clipboardData[itemId].keyword).length == 0, "Item already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedContent, inputProof)), "Invalid encrypted input");

        clipboardData[itemId] = ClipboardItem({
            encryptedContent: FHE.fromExternal(encryptedContent, inputProof),
            timestamp: block.timestamp,
            creator: msg.sender,
            decryptedContent: 0,
            isVerified: false,
            keyword: keyword
        });

        FHE.allowThis(clipboardData[itemId].encryptedContent);
        FHE.makePubliclyDecryptable(clipboardData[itemId].encryptedContent);
        itemIds.push(itemId);

        emit ItemCreated(itemId, msg.sender);
    }

    function verifyDecryption(
        string calldata itemId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(clipboardData[itemId].keyword).length > 0, "Item does not exist");
        require(!clipboardData[itemId].isVerified, "Data already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(clipboardData[itemId].encryptedContent);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        clipboardData[itemId].decryptedContent = decodedValue;
        clipboardData[itemId].isVerified = true;

        emit DecryptionVerified(itemId, decodedValue);
    }

    function getEncryptedContent(string calldata itemId) external view returns (euint32) {
        require(bytes(clipboardData[itemId].keyword).length > 0, "Item does not exist");
        return clipboardData[itemId].encryptedContent;
    }

    function getClipboardItem(string calldata itemId) external view returns (
        uint256 timestamp,
        address creator,
        bool isVerified,
        uint32 decryptedContent,
        string memory keyword
    ) {
        require(bytes(clipboardData[itemId].keyword).length > 0, "Item does not exist");
        ClipboardItem storage item = clipboardData[itemId];

        return (
            item.timestamp,
            item.creator,
            item.isVerified,
            item.decryptedContent,
            item.keyword
        );
    }

    function getAllItemIds() external view returns (string[] memory) {
        return itemIds;
    }

    function searchItemsByKeyword(string calldata keyword) external view returns (string[] memory) {
        string[] memory results = new string[](itemIds.length);
        uint256 count = 0;

        for (uint256 i = 0; i < itemIds.length; i++) {
            if (keccak256(bytes(clipboardData[itemIds[i]].keyword)) == keccak256(bytes(keyword))) {
                results[count] = itemIds[i];
                count++;
            }
        }

        assembly {
            mstore(results, count)
        }

        return results;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


