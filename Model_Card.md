# EU AI Act GPAI Transparency Summary: gpt-oss-safeguards-20B

## 1. General Information
This section outlines high-level identifying and structural information about the model and its training characteristics.

- **Provider:** OpenAI [4].  
- **Model Identification:** `gpt-oss-20b` (adaptable as `gpt-oss-safeguards-20B`) is an open-weight reasoning model released under the Apache 2.0 license and the gpt-oss usage policy [18]. It is an autoregressive Mixture-of-Experts (MoE) transformer that builds upon GPT-2 and GPT-3 architectures [34].  
- **Release Date:** August 5, 2025 [5].  
- **Model Size & Architecture:** 24 layers, ~20.9 billion total parameters, and ~3.6 billion active parameters per token per forward pass [37, 40]. The model uses MXFP4 quantization (≈4.25 bits per parameter) to reduce memory footprint, enabling operation on systems with as little as 16 GB RAM [43, 44, 45].  
- **Training Data Modalities:** Text-only [19, 141].  
- **Estimated Overall Training Data Size:** Trillions of tokens [141].  
- **Linguistic & Demographic Characteristics:** Multilingual capabilities; evaluated on a professionally human-translated benchmark across 14 languages: Arabic, Bengali, Chinese, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Portuguese, Spanish, Swahili, and Yoruba [371, 375].  
- **Data Focus & Cutoff:** Training data emphasizes STEM, coding, and general knowledge. Knowledge cutoff: June 2024 [141, 143].

---

## 2. List of Data Sources
This section summarizes the origins of datasets used across training stages. *(Note: the available documentation emphasizes architecture and safety; granular dataset names are not disclosed.)*

- **Publicly Available Datasets:** Pre-training used a text-only corpus of trillions of tokens focused on STEM, coding, and general knowledge [141]. Specific public dataset names and links are not detailed in the source text.  
- **Commercially Licensed and Private Datasets:** The provided documentation does not explicitly confirm or list commercial or private datasets used for base pre-training.  
- **Crawled and Scraped Data:** The model includes a browsing tool for agentic workflows to fetch web information beyond the knowledge cutoff [273, 274]. The specific crawlers, collection periods, and domain lists used for pre-training are not disclosed.  
- **User Data:** The document does not explicitly state whether user interaction data was used for training. It notes post-training used Chain-of-Thought (CoT) reinforcement learning techniques similar to OpenAI o3, producing behavior aligned with first-party conversational products [208, 209].  
- **Synthetic Data:** The documentation does not identify specific models used to generate synthetic training data.

---

## 3. Data Processing & Safeguard Aspects
This section outlines data processing measures, safety testing, and guardrails implemented to improve compliance and model safety.

- **Copyright Compliance (TDM Exception):** The document does not detail measures for identifying or respecting opt-outs under the EU text and data mining (TDM) exception.  
- **Removal of Illegal and Harmful Content (Data Filtering):** Pre-training data was filtered for harmful content. The model reused CBRN (Chemical, Biological, Radiological, Nuclear) pre-training filters from GPT-4o to remove hazardous biosecurity knowledge [142].  
- **Post-Training Alignment & Safety:** The model underwent alignment training to refuse unsafe prompts (e.g., illicit advice) and to be robust against jailbreaks. It is evaluated against disallowed content categories including sexual content involving minors, self-harm instructions, and illicit/violent material [382, 402, 417].  
- **Instruction Hierarchy (Guardrail Integrity):** The model is trained to follow a strict instruction hierarchy using a "harmony prompt format": system messages take precedence over developer messages, which take precedence over user messages [435–438].  
- **Chain-of-Thought (CoT) Transparency:** Developers avoided optimization pressure that would encourage the model to "hide its thinking." Because CoT outputs may contain hallucinations or unfiltered content, downstream developers are advised not to expose raw CoT to end users without additional moderation [459–464].

---

## 4. References
- OpenAI. (2025). *gpt-oss-120b & gpt-oss-20b Model Card*. arXiv. https://arxiv.org/abs/2508.10925

*(Bracketed numeric citations above refer to the source document's internal reference indices.)*
