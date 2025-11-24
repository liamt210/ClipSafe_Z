import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface ClipboardData {
  id: string;
  name: string;
  encryptedValue: number;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

interface SearchFilters {
  keyword: string;
  dateRange: string;
  verifiedOnly: boolean;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [clipboardData, setClipboardData] = useState<ClipboardData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingData, setCreatingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newData, setNewData] = useState({ name: "", value: "", description: "" });
  const [selectedData, setSelectedData] = useState<ClipboardData | null>(null);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({ keyword: "", dateRange: "all", verifiedOnly: false });
  const [showFAQ, setShowFAQ] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || !initialize) return;
      
      try {
        console.log('Initializing FHEVM for ClipSafe...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadClipboardData();
        await loadUserHistory();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadClipboardData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const dataList: ClipboardData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          dataList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setClipboardData(dataList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const loadUserHistory = async () => {
    if (!address) return;
    const history = clipboardData.filter(data => data.creator.toLowerCase() === address.toLowerCase());
    setUserHistory(history);
  };

  const createClipboardData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting data with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const value = parseInt(newData.value) || 0;
      const businessId = `clip-${Date.now()}`;
      
      const contractAddress = await contract.getAddress();
      const encryptedResult = await encrypt(contractAddress, address, value);
      
      const tx = await contract.createBusinessData(
        businessId,
        newData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Storing encrypted data on-chain..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data encrypted and stored successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadClipboardData();
      setShowCreateModal(false);
      setNewData({ name: "", value: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingData(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractWrite.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadClipboardData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadClipboardData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const handleSearch = (filters: SearchFilters) => {
    setSearchFilters(filters);
  };

  const filteredData = clipboardData.filter(item => {
    const matchesKeyword = item.name.toLowerCase().includes(filters.keyword.toLowerCase()) ||
                          item.description.toLowerCase().includes(filters.keyword.toLowerCase());
    const matchesVerification = !filters.verifiedOnly || item.isVerified;
    return matchesKeyword && matchesVerification;
  });

  const stats = {
    total: clipboardData.length,
    verified: clipboardData.filter(item => item.isVerified).length,
    userItems: userHistory.length,
    recent: clipboardData.filter(item => Date.now()/1000 - item.timestamp < 86400).length
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <h1>🔐 ClipSafe_Z</h1>
            <span>FHE-based Secure Clipboard</span>
          </div>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </header>
        
        <div className="connection-prompt metal-bg">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect to Access Secure Clipboard</h2>
            <p>Your encrypted clipboard data is protected by Zama FHE technology</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen metal-bg">
        <div className="fhe-spinner metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen metal-bg">
      <div className="fhe-spinner metal-spinner"></div>
      <p>Loading encrypted clipboard...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header metal-header">
        <div className="logo">
          <h1>🔐 ClipSafe_Z</h1>
          <span>FHE-based Secure Clipboard</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn"
          >
            + New Encrypted Item
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-section">
          <div className="stat-card metal-card">
            <h3>Total Items</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-card metal-card">
            <h3>Verified</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
          <div className="stat-card metal-card">
            <h3>Your Items</h3>
            <div className="stat-value">{stats.userItems}</div>
          </div>
          <div className="stat-card metal-card">
            <h3>Recent (24h)</h3>
            <div className="stat-value">{stats.recent}</div>
          </div>
        </div>

        <SearchFiltersComponent 
          filters={searchFilters} 
          onSearch={handleSearch}
          onShowFAQ={() => setShowFAQ(!showFAQ)}
        />

        <div className="data-section">
          <div className="section-header">
            <h2>Encrypted Clipboard Items</h2>
            <button 
              onClick={loadClipboardData} 
              className="refresh-btn metal-btn"
              disabled={isRefreshing}
            >
              {isRefreshing ? "🔄" : "Refresh"}
            </button>
          </div>
          
          <div className="data-list">
            {filteredData.length === 0 ? (
              <div className="no-data metal-card">
                <p>No encrypted items found</p>
                <button 
                  className="create-btn metal-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Item
                </button>
              </div>
            ) : filteredData.map((item, index) => (
              <ClipboardItem 
                key={index}
                item={item}
                onSelect={setSelectedData}
                onDecrypt={decryptData}
                isDecrypting={fheIsDecrypting}
              />
            ))}
          </div>
        </div>

        {showFAQ && <FAQSection />}
        
        <UserHistory history={userHistory} />
      </div>
      
      {showCreateModal && (
        <CreateModal 
          onSubmit={createClipboardData} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingData || isEncrypting}
          data={newData}
          setData={setNewData}
        />
      )}
      
      {selectedData && (
        <DetailModal 
          item={selectedData}
          onClose={() => setSelectedData(null)}
          onDecrypt={decryptData}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <TransactionToast status={transactionStatus} />
      )}
    </div>
  );
};

const SearchFiltersComponent: React.FC<{ 
  filters: SearchFilters; 
  onSearch: (filters: SearchFilters) => void;
  onShowFAQ: () => void;
}> = ({ filters, onSearch, onShowFAQ }) => {
  return (
    <div className="search-filters metal-card">
      <div className="search-group">
        <input 
          type="text" 
          placeholder="Search items..."
          value={filters.keyword}
          onChange={(e) => onSearch({ ...filters, keyword: e.target.value })}
          className="metal-input"
        />
      </div>
      <div className="filter-group">
        <label className="metal-checkbox">
          <input 
            type="checkbox" 
            checked={filters.verifiedOnly}
            onChange={(e) => onSearch({ ...filters, verifiedOnly: e.target.checked })}
          />
          Verified Only
        </label>
        <button onClick={onShowFAQ} className="faq-btn metal-btn">FAQ</button>
      </div>
    </div>
  );
};

const ClipboardItem: React.FC<{
  item: ClipboardData;
  onSelect: (item: ClipboardData) => void;
  onDecrypt: (id: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ item, onSelect, onDecrypt, isDecrypting }) => {
  const [decrypting, setDecrypting] = useState(false);

  const handleDecrypt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDecrypting(true);
    await onDecrypt(item.id);
    setDecrypting(false);
  };

  return (
    <div className="clipboard-item metal-card" onClick={() => onSelect(item)}>
      <div className="item-header">
        <h3>{item.name}</h3>
        <span className={`status-badge ${item.isVerified ? 'verified' : 'encrypted'}`}>
          {item.isVerified ? '✅ Verified' : '🔒 Encrypted'}
        </span>
      </div>
      <p className="item-desc">{item.description}</p>
      <div className="item-meta">
        <span>{new Date(item.timestamp * 1000).toLocaleDateString()}</span>
        <span>{item.creator.substring(0, 6)}...{item.creator.substring(38)}</span>
      </div>
      <div className="item-actions">
        <button 
          className={`decrypt-btn metal-btn ${item.isVerified ? 'verified' : ''}`}
          onClick={handleDecrypt}
          disabled={decrypting || isDecrypting}
        >
          {decrypting || isDecrypting ? 'Decrypting...' : item.isVerified ? '✅ Verified' : '🔓 Decrypt'}
        </button>
        {item.isVerified && item.decryptedValue !== undefined && (
          <span className="decrypted-value">Value: {item.decryptedValue}</span>
        )}
      </div>
    </div>
  );
};

const CreateModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  data: any;
  setData: (data: any) => void;
}> = ({ onSubmit, onClose, creating, data, setData }) => {
  return (
    <div className="modal-overlay metal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>New Encrypted Item</h2>
          <button onClick={onClose} className="close-btn metal-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>Item Name</label>
            <input 
              type="text" 
              value={data.name}
              onChange={(e) => setData({ ...data, name: e.target.value })}
              className="metal-input"
              placeholder="Enter item name..."
            />
          </div>
          
          <div className="form-group">
            <label>Numeric Value (FHE Encrypted)</label>
            <input 
              type="number" 
              value={data.value}
              onChange={(e) => setData({ ...data, value: e.target.value.replace(/[^\d]/g, '') })}
              className="metal-input"
              placeholder="Enter numeric value..."
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              value={data.description}
              onChange={(e) => setData({ ...data, description: e.target.value })}
              className="metal-input"
              placeholder="Enter description..."
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || !data.name || !data.value}
            className="submit-btn metal-btn"
          >
            {creating ? "Encrypting..." : "Create Encrypted Item"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailModal: React.FC<{
  item: ClipboardData;
  onClose: () => void;
  onDecrypt: (id: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ item, onClose, onDecrypt, isDecrypting }) => {
  const [decrypting, setDecrypting] = useState(false);

  const handleDecrypt = async () => {
    setDecrypting(true);
    await onDecrypt(item.id);
    setDecrypting(false);
  };

  return (
    <div className="modal-overlay metal-overlay">
      <div className="detail-modal metal-card">
        <div className="modal-header">
          <h2>Item Details</h2>
          <button onClick={onClose} className="close-btn metal-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-info">
            <div className="info-row">
              <span>Name:</span>
              <strong>{item.name}</strong>
            </div>
            <div className="info-row">
              <span>Description:</span>
              <span>{item.description}</span>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <span>{item.creator}</span>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <span>{new Date(item.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <span className={item.isVerified ? 'verified' : 'encrypted'}>
                {item.isVerified ? '✅ On-chain Verified' : '🔒 Encrypted'}
              </span>
            </div>
          </div>
          
          {item.isVerified && (
            <div className="decrypted-section">
              <h3>Decrypted Value</h3>
              <div className="decrypted-value">{item.decryptedValue}</div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          {!item.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={decrypting || isDecrypting}
              className="decrypt-btn metal-btn"
            >
              {decrypting || isDecrypting ? 'Decrypting...' : '🔓 Decrypt & Verify'}
            </button>
          )}
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

const FAQSection: React.FC = () => {
  const faqs = [
    { q: "What is FHE?", a: "Fully Homomorphic Encryption allows computations on encrypted data without decryption." },
    { q: "How is my data protected?", a: "Data is encrypted using Zama FHE before being stored on-chain." },
    { q: "What data types are supported?", a: "Currently only integer values can be encrypted and processed." }
  ];

  return (
    <div className="faq-section metal-card">
      <h3>Frequently Asked Questions</h3>
      {faqs.map((faq, index) => (
        <div key={index} className="faq-item">
          <strong>Q: {faq.q}</strong>
          <p>A: {faq.a}</p>
        </div>
      ))}
    </div>
  );
};

const UserHistory: React.FC<{ history: any[] }> = ({ history }) => {
  if (history.length === 0) return null;

  return (
    <div className="history-section metal-card">
      <h3>Your Recent Items</h3>
      <div className="history-list">
        {history.slice(0, 5).map((item, index) => (
          <div key={index} className="history-item">
            <span>{item.name}</span>
            <span className={item.isVerified ? 'verified' : 'pending'}>
              {item.isVerified ? 'Verified' : 'Pending'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const TransactionToast: React.FC<{ status: any }> = ({ status }) => {
  return (
    <div className={`transaction-toast metal-toast ${status.status}`}>
      <div className="toast-content">
        <div className="toast-icon">
          {status.status === "pending" && "⏳"}
          {status.status === "success" && "✅"}
          {status.status === "error" && "❌"}
        </div>
        <div className="toast-message">{status.message}</div>
      </div>
    </div>
  );
};

export default App;


