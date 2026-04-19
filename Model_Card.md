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

### 4. EU AI Act Article 53(1)(d) Requirements Mapping

This section maps the available documentation to the disclosure requirements in Article 53(1)(d) of the EU AI Act. Each item indicates whether the requirement is **Answered**, **Partially Answered**, or **Not Answered** in the source material, with supporting citations where available.

- **Provider and Model Identification:** **Answered.**  
  The document identifies the provider as OpenAI [4] and the models as `gpt-oss-120b` and `gpt-oss-20b` [18]. It provides a release date of August 5, 2025 [5] and notes that the models build upon GPT-2 and GPT-3 architectures [34].

- **Training Data Characteristics:** **Answered.**  
  The document specifies the data modality as text-only [19, 141] and gives a broad estimate of training size as "trillions of tokens" [141]. It states a focus on STEM, coding, and general knowledge [141] and reports multilingual evaluation across 14 languages [371].

- **Publicly Available Datasets:** **Not Answered.**  
  The documentation references a large pre-training corpus [141] but does not name specific public datasets or provide links to datasets that constitute a material fraction (e.g., >3%) of the training data.

- **Commercially Licensed and Private Datasets:** **Not Answered.**  
  The documentation does not disclose whether commercially licensed or private datasets were used for base pre-training.

- **Crawled and Scraped Data:** **Not Answered.**  
  There is no disclosure of web crawlers, collection periods, or lists of the most relevant internet domains used in pre-training. The model does include a browsing tool for agentic workflows [273, 274], but that does not substitute for pre-training provenance.

- **User Data:** **Not Answered.**  
  The document does not state whether user interaction data was incorporated into training. It does note post-training techniques (CoT RL) similar to other conversational products [208, 209].

- **Synthetic Data:** **Not Answered.**  
  The text does not disclose whether AI-generated synthetic data was used in pre-training nor does it name models used to generate such data.

- **Copyright Compliance (TDM Exception):** **Not Answered.**  
  The document does not describe measures to identify or respect reservations of rights (opt-outs) under the EU text and data mining (TDM) exception.

- **Removal of Illegal Content:** **Partially Answered.**  
  The document states that pre-training data was filtered for harmful content and that CBRN pre-training filters from GPT-4o were reused to remove hazardous biosecurity knowledge [142]. However, it does not explicitly describe measures for removing illegal content categories such as child sexual abuse material (CSAM) or specific procedures for handling IP-infringing content.

**Notes:** bracketed numeric citations above refer to the source document's internal reference indices. Where the source is silent, the mapping marks the requirement as **Not Answered** to reflect lack of disclosure rather than absence of controls in practice.


---

## 5. References
- OpenAI. (2025). *gpt-oss-120b & gpt-oss-20b Model Card*. arXiv. https://arxiv.org/abs/2508.10925

*(Bracketed numeric citations above refer to the source document's internal reference indices.)*

---


